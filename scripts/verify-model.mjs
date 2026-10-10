import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { HarnessGateway } from '@shouwei/harness-adapter'

// Opt-in manual probe. Only this script reads the user's environment settings;
// automated tests never load .env or send requests to a real model provider.
const env = process.env
const required = ['SHOUWEI_BASE_URL', 'SHOUWEI_MODEL_ID', 'SHOUWEI_CONTEXT_WINDOW', 'SHOUWEI_MAX_OUTPUT_TOKENS']
if (required.some(name => !env[name]) || (!env.SHOUWEI_API_KEY && env.SHOUWEI_NO_CREDENTIAL !== '1')) {
  console.error('缺少模型配置。请按 .env.example 在本机填写地址、模型 ID、容量和密钥；不要把密钥发进聊天。')
  process.exitCode = 1
} else {
  const runRoot = await mkdtemp(join(tmpdir(), 'shouwei-model-probe-'))
  const connection = {
    id: 'manual-probe', displayName: '用户模型验证', protocol: 'openai-chat',
    baseUrl: env.SHOUWEI_BASE_URL, modelId: env.SHOUWEI_MODEL_ID,
    credentialRef: env.SHOUWEI_NO_CREDENTIAL === '1' ? null : 'manual-key',
    contextWindow: Number(env.SHOUWEI_CONTEXT_WINDOW), maxOutputTokens: Number(env.SHOUWEI_MAX_OUTPUT_TOKENS),
    requestTimeoutMs: Number(env.SHOUWEI_TIMEOUT_MS ?? 60000),
    capabilities: { text: 'untested', stream: 'untested', jsonMode: 'untested', tools: 'untested', vision: 'untested', usage: 'untested' },
  }
  const gateway = new HarnessGateway({
    getConnection: id => id === connection.id ? connection : null,
    getSecret: () => env.SHOUWEI_API_KEY ?? null, runRoot,
  })
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    const result = await gateway.analyze({
      runId: 'manual-probe', stage: 'check', schemaVersion: 1,
      systemInstruction: 'Read the supplied synthetic material and return {"ok":true}.',
      dataBlocks: ['Synthetic test only. No private documents.'],
      modelConnectionId: connection.id, inputHash: 'probe-v1', outputSchema: z.object({ ok: z.literal(true) }),
    }, controller.signal)
    // No endpoint, key, prompts, raw provider error, or stack trace is printed.
    console.log(JSON.stringify(result.ok
      ? { ok: true, textReply: 'verified', structuredOutput: 'verified', streaming: 'untested', usage: result.data.usage, durationMs: result.data.durationMs }
      : { ok: false, error: result.error }, null, 2))
    if (!result.ok) process.exitCode = 1
  } finally {
    const closed = await gateway.close()
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    if (closed.confirmed) await rm(runRoot, { recursive: true, force: true })
    else { console.error('STOP_UNCONFIRMED：请重启应用后重试。'); process.exitCode = 1 }
  }
}
