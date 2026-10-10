import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { afterEach, expect, it, vi } from 'vitest'
import type { AnalysisRequest, ModelConnection } from '@shouwei/contracts'
import { HarnessGateway, buildRuntimeLaunch } from '@shouwei/harness-adapter'
import { MockModelServer, type MockBehavior } from '../support/mock-server.js'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function setup(behavior: MockBehavior) {
  const server = await MockModelServer.start(behavior)
  const runRoot = await mkdtemp(join(tmpdir(), 'shouwei-regression-'))
  cleanups.push(() => rm(runRoot, { recursive: true, force: true }), () => server.close())
  const connection: ModelConnection = {
    id: 'connection', displayName: 'Synthetic local model', protocol: 'openai-chat', baseUrl: server.baseUrl,
    modelId: 'test-model', credentialRef: 'test-key', contextWindow: 64000, maxOutputTokens: 4096,
    requestTimeoutMs: 8000,
    capabilities: { text: 'untested', stream: 'untested', jsonMode: 'untested', tools: 'untested', vision: 'untested', usage: 'untested' },
  }
  const gateway = new HarnessGateway({ getConnection: () => connection, getSecret: () => 'synthetic-secret', runRoot })
  cleanups.push(() => gateway.close())
  const request: AnalysisRequest<{ ok: boolean }> = {
    runId: randomUUID(), stage: 'check', schemaVersion: 1,
    systemInstruction: 'Return a JSON object meeting the supplied output schema.', dataBlocks: ['Synthetic, non-private input.'],
    modelConnectionId: connection.id, inputHash: 'fixture', outputSchema: z.object({ ok: z.boolean() }),
  }
  return { server, runRoot, connection, gateway, request }
}

it('pre-aborted requests never contact the model', async () => {
  const { server, gateway, request } = await setup('success')
  const result = await gateway.analyze(request, AbortSignal.abort())
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error.code).toBe('CANCELLED')
  expect(server.hits).toHaveLength(0)
})

it('successful real SDK turns send the output schema and expose no tools', async () => {
  const { server, gateway, request } = await setup('success')
  const result = await gateway.analyze(request, new AbortController().signal)
  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.data.data).toEqual({ ok: true })
    expect(result.data.usage).toEqual({ promptTokens: 12, completionTokens: 8 })
  }
  expect(server.hits).toHaveLength(1)
  const body = server.hits[0]!.body as { tools?: unknown[]; messages: Array<{role: string; content: string}> }
  expect(body.tools ?? []).toEqual([])
  expect(body.messages.find(message => message.role === 'system')?.content).toContain('"required":["ok"]')
})

it('a repaired reply sums both request usages', async () => {
  const { server, gateway, request } = await setup('repair-success')
  const result = await gateway.analyze(request, new AbortController().signal)
  expect(result.ok).toBe(true)
  if (result.ok) expect(result.data.usage).toEqual({ promptTokens: 24, completionTokens: 16 })
  expect(server.hits).toHaveLength(2)
})

it('request timeout actually stops a hanging request', async () => {
  const { gateway, request, connection } = await setup('hang')
  connection.requestTimeoutMs = 1200
  const started = Date.now()
  const result = await gateway.analyze(request, new AbortController().signal)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error.code).toBe('REQUEST_TIMEOUT')
  expect(Date.now() - started).toBeLessThan(15000)
}, 18000)

it('cancels during the repair attempt as well as the initial attempt', async () => {
  const { server, gateway, request } = await setup('repair-hang')
  const controller = new AbortController()
  const pending = gateway.analyze(request, controller.signal)
  await vi.waitFor(() => expect(server.hits.length).toBe(2), { timeout: 10000 })
  controller.abort()
  const result = await pending
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error.code).toBe('CANCELLED')
}, 20000)

it('rejects traversal run ids before creating runtime files', async () => {
  const { server, gateway, request } = await setup('success')
  request.runId = '../escape'
  const result = await gateway.analyze(request, new AbortController().signal)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT')
  expect(server.hits).toHaveLength(0)
})

it('testConnection performs an actual local synthetic call instead of returning an empty stub', async () => {
  const { server, gateway, connection } = await setup('success')
  const result = await gateway.testConnection(connection)
  expect(result.textReply).toBe('verified')
  expect(result.structuredOutput).toBe('verified')
  expect(server.hits).toHaveLength(1)
})

it('model limits reach the runtime config without embedding secrets', async () => {
  const { connection, runRoot } = await setup('success')
  const launch = await buildRuntimeLaunch(connection, 'synthetic-secret', join(runRoot, 'config'), 'persona')
  const text = await readFile(launch.patchPath, 'utf8')
  expect(text).toContain('contextWindow: 64000')
  expect(text).not.toContain('synthetic-secret')
})

it('rejects concurrent analyze calls without stopping the active call', async () => {
  const { server, gateway, request } = await setup('hang')
  const controller = new AbortController()
  const first = gateway.analyze(request, controller.signal)
  await vi.waitFor(() => expect(server.hits.length).toBe(1), { timeout: 10000 })
  const second = await gateway.analyze({ ...request, runId: randomUUID() }, new AbortController().signal)
  expect(second.ok).toBe(false)
  if (!second.ok) expect(second.error.code).toBe('RUNTIME_BUSY')
  expect(server.hits).toHaveLength(1)
  controller.abort()
  const result = await first
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error.code).toBe('CANCELLED')
})

it('explicit no-credential mode works against a loopback server', async () => {
  const { server, connection, gateway, request } = await setup('success')
  connection.credentialRef = null
  const result = await gateway.analyze(request, new AbortController().signal)
  expect(result.ok).toBe(true)
  expect(server.hits).toHaveLength(1)
  expect(server.hits[0]!.auth).toBe('Bearer shouwei-local-no-credential')
})

it('closing a gateway stops its current request before returning', async () => {
  const { server, gateway, request } = await setup('hang')
  const pending = gateway.analyze(request, new AbortController().signal)
  await vi.waitFor(() => expect(server.hits.length).toBe(1), { timeout: 10000 })
  expect(await gateway.close()).toEqual({ confirmed: true })
  const result = await pending
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error.code).toBe('CANCELLED')
  const afterClose = await gateway.analyze(request, new AbortController().signal)
  expect(afterClose.ok).toBe(false)
  expect(server.hits).toHaveLength(1)
})

it.each([
  { baseUrl: 'not-a-url' },
  { baseUrl: 'file:///tmp/model' },
  { baseUrl: 'https://user:password@example.invalid/v1' },
  { maxOutputTokens: 100000 },
  { extraHeaderRefs: { Authorization: 'secret-reference' } },
])('rejects invalid or unsupported configuration before network access: %j', async patch => {
  const { server, connection, gateway, request } = await setup('success')
  Object.assign(connection, patch)
  const result = await gateway.analyze(request, new AbortController().signal)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT')
  expect(server.hits).toHaveLength(0)
})

it('connection test reports credential failure without exposing provider text', async () => {
  const { server, connection, gateway } = await setup('unauthorized')
  const result = await gateway.testConnection(connection)
  expect(result.textReply).toBe('untested')
  expect(result.error?.code).toBe('INVALID_CREDENTIAL')
  expect(JSON.stringify(result)).not.toContain('synthetic-secret')
  expect(server.hits).toHaveLength(1)
})

it('accepts JSON null when the output schema explicitly permits it', async () => {
  const { server, gateway, request } = await setup('json-null')
  const result = await gateway.analyze({ ...request, outputSchema: z.null() }, new AbortController().signal)
  expect(result.ok).toBe(true)
  if (result.ok) expect(result.data.data).toBeNull()
  expect(server.hits).toHaveLength(1)
})

it('does not invent zero token usage when the endpoint omits accounting', async () => {
  const { gateway, request } = await setup('no-usage')
  const result = await gateway.analyze(request, new AbortController().signal)
  expect(result.ok).toBe(true)
  if (result.ok) expect(result.data.usage).toBeNull()
})

it('reports rate limits without a JSON-repair request or hidden network retries', async () => {
  const { server, gateway, request } = await setup('rate-limited')
  const result = await gateway.analyze(request, new AbortController().signal)
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.error.code).toBe('RATE_LIMITED')
    expect(result.error.retryable).toBe(true)
  }
  expect(server.hits).toHaveLength(1)
})

it('close also waits for an in-flight connection probe to settle', async () => {
  const { server, gateway, connection } = await setup('hang')
  let settled = false
  const probe = gateway.testConnection(connection).then(result => { settled = true; return result })
  await vi.waitFor(() => expect(server.hits.length).toBe(1), { timeout: 10000 })
  await gateway.close()
  expect(settled).toBe(true)
  expect((await probe).error?.code).toBe('CANCELLED')
})
