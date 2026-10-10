import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import type { ModelConnection } from '@shouwei/contracts'

/** 产品在 dsh 中的提供方路由名；用户模型经此路由访问。 */
export const PROVIDER_ROUTE = 'shouwei'

/** 密钥环境变量名；patch 中只引用名称，不包含密钥本身。 */
export const API_KEY_ENV = 'SHOUWEI_API_KEY'

/**
 * dsh-base 中所有会向模型暴露工具的行 ID。
 * 只读分析组合将其全部禁用，使模型没有 shell、文件、网络与子代理工具。
 */
export const TOOL_ROW_IDS = [
  'tool-bash',
  'tool-pwsh',
  'tool-fs',
  'tool-fs-search',
  'tool-working-directory',
  'tool-jobs',
  'tool-skill',
  'tool-subagent',
  'tool-subagent-control',
  'tool-subagent-list-agents',
  'tool-subagent-fork',
  'tool-web',
  'tool-workflow',
  'tool-todo',
  'tool-goal',
  'tool-ask-user',
  'tool-schedule',
  'tool-present',
  'tool-cordis',
  'tool-plugin-manager',
  'plan-mode',
  'workspace-dependencies',
  'skill-office',
] as const

/** 传给 dsh 子进程的启动配置。 */
export interface RuntimeLaunch {
  /** 本次运行生成的具体 patch 文件（绝对路径）。 */
  patchPath: string
  /** 独享 DSH_HOME（绝对路径）。 */
  dshHome: string
  /** 子进程环境（整体替换）。 */
  env: NodeJS.ProcessEnv
  provider: string
  model: string
  maxTokens: number
}

/** 阶段 0 使用的固定模板 patch：随仓库分发，位于 runtime/shouwei.patch.yml。 */
const TEMPLATE_PATH = process.env.SHOUWEI_RUNTIME_PATCH ?? resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../runtime/shouwei.patch.yml',
)

/** 运行时模板的结构：一组行覆盖。 */
interface PatchRow {
  id?: string
  disabled?: boolean
  config?: Record<string, unknown>
  insert?: unknown[]
}

/**
 * 读取模板并注入本次连接的提供方配置与系统提示词，
 * 在 runDir 下生成一份具体 patch。
 */
export async function buildRuntimeLaunch(
  connection: ModelConnection,
  secret: string | null,
  runDir: string,
  systemInstruction: string,
): Promise<RuntimeLaunch> {
  await mkdir(runDir, { recursive: true })
  const dshHome = join(runDir, 'dsh-home')
  await mkdir(dshHome, { recursive: true })

  const template = yaml.load(await readTemplate(), { filename: TEMPLATE_PATH }) as PatchRow[]
  const rows = [...template]
  upsertRow(rows, {
    id: 'system-prompt',
    config: { personaPrefix: systemInstruction },
  })
  upsertRow(rows, {
    id: 'llm-pi-ai',
    config: {
      providers: {
        [PROVIDER_ROUTE]: {
          api: 'openai-completions',
          baseURL: connection.baseUrl,
          apiKeyEnv: API_KEY_ENV,
          retryPolicy: { mode: 'normal', maxRetries: 0 },
          models: [{ id: connection.modelId, contextWindow: connection.contextWindow, maxTokens: connection.maxOutputTokens }],
        },
      },
    },
  })

  const patchPath = join(runDir, 'shouwei.runtime.patch.yml')
  await writeFile(
    patchPath,
    '# 由 connection.ts 基于 runtime/shouwei.patch.yml 生成，请勿手改\n' + yaml.dump(rows),
    'utf8',
  )

  return {
    patchPath,
    dshHome,
    // pi-ai's OpenAI transport requires a nonempty key even for local servers.
    // This public placeholder is only used for explicitly keyless loopback mode.
    env: buildChildEnv(connection.credentialRef === null ? 'shouwei-local-no-credential' : secret),
    provider: PROVIDER_ROUTE,
    model: connection.modelId,
    maxTokens: connection.maxOutputTokens,
  }
}

function upsertRow(rows: PatchRow[], row: PatchRow): void {
  const index = rows.findIndex(item => item.id === row.id)
  if (index === -1) rows.push(row)
  else rows[index] = { ...rows[index], ...row }
}

/** 子进程环境：以最小允许列表构造，密钥只在这里出现。 */
function buildChildEnv(secret: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'SYSTEMROOT', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE']) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  if (secret !== null) env[API_KEY_ENV] = secret
  // Electron 内 process.execPath 是 Electron 二进制；不带此变量会启动出第二个 GUI 实例。
  if (process.versions.electron !== undefined) env.ELECTRON_RUN_AS_NODE = '1'
  return env
}

async function readTemplate(): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  return readFile(TEMPLATE_PATH, 'utf8')
}
