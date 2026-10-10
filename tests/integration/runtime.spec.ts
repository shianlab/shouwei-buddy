import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import * as yaml from 'js-yaml'
import { z } from 'zod'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalysisRequest, ModelConnection } from '@shouwei/contracts'
import {
  buildRuntimeLaunch,
  HarnessGateway,
  RuntimeManager,
  TOOL_ROW_IDS,
  type GatewayContext,
} from '@shouwei/harness-adapter'
import { MockModelServer } from '../support/mock-server.js'

function makeConnection(baseUrl: string): ModelConnection {
  return {
    id: randomUUID(),
    displayName: '测试模型',
    protocol: 'openai-chat',
    baseUrl,
    modelId: 'test-model',
    credentialRef: 'env',
    contextWindow: 64_000,
    maxOutputTokens: 4096,
    requestTimeoutMs: 120_000,
    capabilities: {
      text: 'untested',
      stream: 'untested',
      jsonMode: 'untested',
      tools: 'untested',
      vision: 'untested',
      usage: 'untested',
    },
  }
}

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function makeRunRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'shouwei-test-'))
  roots.push(root)
  return root
}

function makeGatewayContext(connection: ModelConnection, runRoot: string): GatewayContext {
  return {
    getConnection: id => (id === connection.id ? connection : null),
    getSecret: () => 'test-secret-key',
    runRoot,
  }
}

function makeRequest(connection: ModelConnection): AnalysisRequest<{ ok: boolean }> {
  return {
    runId: randomUUID(),
    stage: 'check',
    schemaVersion: 1,
    systemInstruction: '你是收尾搭子的测试分析器，只输出 {"ok": true}。',
    dataBlocks: ['这是一段合成测试材料。'],
    modelConnectionId: connection.id,
    inputHash: randomUUID(),
    outputSchema: z.object({ ok: z.boolean() }),
  }
}

describe('阶段 0 运行时契约', () => {
  it('rejects_unregistered_model', async () => {
    const runRoot = await makeRunRoot()
    const connection = makeConnection('http://127.0.0.1:9/v1')
    const context: GatewayContext = {
      getConnection: () => null,
      getSecret: () => null,
      runRoot,
    }
    const gateway = new HarnessGateway(context)
    const result = await gateway.analyze(makeRequest(connection), new AbortController().signal)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('MODEL_UNREGISTERED')
  })

  it('rejects_invalid_json_after_one_repair', async () => {
    const server = await MockModelServer.start('invalid-json')
    const runRoot = await makeRunRoot()
    const connection = makeConnection(server.baseUrl)
    const gateway = new HarnessGateway(makeGatewayContext(connection, runRoot))
    try {
      const result = await gateway.analyze(makeRequest(connection), new AbortController().signal)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('MODEL_OUTPUT_INVALID')
      // 初次请求 + 一次修复重试 = 2 次，不多不少。
      expect(server.hits.filter(hit => hit.url.includes('chat/completions'))).toHaveLength(2)
    } finally {
      await gateway.close()
      await server.close()
    }
  })

  it('does_not_expose_shell_tools', async () => {
    const templatePath = join(process.cwd(), 'runtime/shouwei.patch.yml')
    const template = (await yaml.load(await readFile(templatePath, 'utf8'))) as Array<{
      id?: string
      disabled?: boolean
    }>
    const templateDisabled = new Set(
      template.filter(row => row.disabled === true).map(row => row.id),
    )
    for (const rowId of TOOL_ROW_IDS) {
      expect(templateDisabled.has(rowId)).toBe(true)
    }

    // 真实 dsh 必须能成功加载这份 patch（语法与行 ID 都有效）。
    const runRoot = await makeRunRoot()
    const connection = makeConnection('http://127.0.0.1:9/v1')
    const launch = await buildRuntimeLaunch(
      connection,
      'test-key',
      join(runRoot, 'r'),
      'persona',
    )
    const generated = (await yaml.load(await readFile(launch.patchPath, 'utf8'))) as Array<{
      id?: string
      disabled?: boolean
    }>
    const generatedDisabled = new Set(
      generated.filter(row => row.disabled === true).map(row => row.id),
    )
    for (const rowId of TOOL_ROW_IDS) {
      expect(generatedDisabled.has(rowId)).toBe(true)
    }

    const manager = new RuntimeManager()
    try {
      await expect(manager.acquire('k', launch)).resolves.toBeDefined()
    } finally {
      await manager.stop()
    }
  })

  it.skipIf(process.platform === 'win32')('cancellation_waits_for_exit', async () => {
    const server = await MockModelServer.start('hang')
    const runRoot = await makeRunRoot()
    const connection = makeConnection(server.baseUrl)
    const launch = await buildRuntimeLaunch(
      connection,
      'test-key',
      join(runRoot, 'cancelling-run'),
      'persona',
    )
    const manager = new RuntimeManager()
    try {
      await manager.acquire('k', launch)
      const harness = await manager.acquire('k', launch)
      void harness.run('take your time').catch(() => {})
      await vi.waitFor(() => expect(server.hits.length).toBe(1), { timeout: 10000 })
      const stopResult = await manager.stop()
      expect(stopResult.confirmed).toBe(true)

      // patch 路径经 argv 传入子进程；退出后进程列表中不应再有该路径残留。
      const psOutput = execFileSync('/bin/ps', ['-ax', '-o', 'pid=,command='], {
        encoding: 'utf8',
      })
      const leftovers = psOutput.split('\n').filter(line => line.includes(launch.patchPath))
      expect(leftovers).toHaveLength(0)
    } finally {
      await manager.stop()
      await server.close()
    }
  })

  it('does_not_retry_invalid_key', async () => {
    const server = await MockModelServer.start('unauthorized')
    const runRoot = await makeRunRoot()
    const connection = makeConnection(server.baseUrl)
    const gateway = new HarnessGateway(makeGatewayContext(connection, runRoot))
    try {
      const result = await gateway.analyze(makeRequest(connection), new AbortController().signal)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('INVALID_CREDENTIAL')
      // 上游重试已关闭，且失败在格式校验前显影：401 只请求一次。
      expect(server.hits.filter(hit => hit.url.includes('chat/completions'))).toHaveLength(1)
    } finally {
      await gateway.close()
      await server.close()
    }
  })
})
