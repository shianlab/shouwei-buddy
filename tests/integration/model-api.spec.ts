import { it, expect } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createLocalServer } from '../../apps/server/src/server.js'
import { MockModelServer } from '../support/mock-server.js'
it('real settings and probe use the SDK, never echo keys or persist them, and require local request headers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shouwei-model-api-'))
  const provider = await MockModelServer.start('success')
  const app = await createLocalServer({ dataDir: root, port: 0 })
  const headers = { 'x-shouwei-request': 'local', 'content-type': 'application/json' }
  const send = (path: string, data?: unknown) =>
    fetch(app.url + path, {
      method: data ? 'POST' : 'GET',
      headers,
      ...(data ? { body: JSON.stringify(data) } : {}),
    })
  try {
    expect((await fetch(app.url + '/api/model')).status).toBe(403)
    const first = await send('/api/model')
    expect(first.status).toBe(200)
    expect(((await first.json()) as { data: { configured: boolean } }).data.configured).toBe(
      false,
    )
    const settings = {
      displayName: '本机测试',
      baseUrl: provider.baseUrl,
      modelId: 'test-model',
      contextWindow: 64000,
      maxOutputTokens: 4096,
      requestTimeoutMs: 8000,
      apiKey: 'private-synthetic-key',
      noCredential: false,
    }
    const configured = await send('/api/model', settings)
    expect(configured.status).toBe(200)
    expect(await configured.text()).not.toContain('private-synthetic-key')
    expect(provider.hits).toHaveLength(0)
    const tested = await send('/api/model/test', {})
    expect(tested.status).toBe(200)
    expect(((await tested.json()) as { data: { tested: boolean } }).data.tested).toBe(true)
    expect(provider.hits[0]?.auth).toBe('Bearer private-synthetic-key')
    expect(
      (await readFile(join(root, 'shouwei.sqlite'))).includes(
        Buffer.from('private-synthetic-key'),
      ),
    ).toBe(false)
    const unsafe = await send('/api/model', {
      ...settings,
      baseUrl: 'http://public.example/v1',
    })
    expect(unsafe.status).toBe(400)
  } finally {
    await app.close()
    await provider.close()
    await rm(root, { recursive: true, force: true })
  }
})
