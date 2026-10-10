import { afterEach, it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import type { Project, ProjectDetail, Selection, ImportResult } from '@shouwei/contracts'
import { createLocalServer } from '../../apps/server/src/server.js'
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'shouwei-api-'))
  const app = await createLocalServer({ dataDir: root, port: 0 })
  cleanups.push(async () => {
    await app.close()
    await rm(root, { recursive: true, force: true })
  })
  return app
}
it('a missing web build does not leave a lock that prevents the next startup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shouwei-startup-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  await expect(
    createLocalServer({ dataDir: root, port: 0, webRoot: join(root, 'missing') }),
  ).rejects.toThrow()
  const app = await createLocalServer({ dataDir: root, port: 0 })
  await app.close()
})
it('API rejects untrusted origins, missing request headers, forged host and arbitrary filesystem paths', async () => {
  const app = await setup()
  const url = app.url
  for (const headers of [{}, { 'x-shouwei-request': 'local', origin: 'https://evil.example' }])
    expect((await fetch(url + '/api/projects', { headers })).status).toBe(403)
  const forged = await new Promise<number>((resolve) => {
    const req = request(
      url + '/api/projects',
      { headers: { 'x-shouwei-request': 'local', host: 'evil.example' } },
      (res) => {
        res.resume()
        resolve(res.statusCode!)
      },
    )
    req.end()
  })
  expect(forged).toBe(403)
  const response = await fetch(url + '/api/projects', {
    method: 'POST',
    headers: { 'x-shouwei-request': 'local', 'content-type': 'application/json' },
    body: JSON.stringify({
      name: '材料',
      recipient: '',
      goal: '要求',
      sourcePath: '/etc/passwd',
    }),
  })
  expect(response.status).toBe(400)
})
it('API persists real project, imports selected bytes, parses them, and never mixes demo data', async () => {
  const app = await setup()
  const headers = { 'x-shouwei-request': 'local', 'content-type': 'application/json' }
  const send = async <T>(path: string, data?: unknown) => {
    const r = await fetch(app.url + path, {
      method: data ? 'POST' : 'GET',
      headers,
      ...(data ? { body: JSON.stringify(data) } : {}),
    })
    return (await r.json()) as { ok: boolean; data: T }
  }
  expect((await send<Project[]>('/api/projects')).data).toEqual([])
  const p = (
    await send<Project>('/api/projects', { name: '真实项目', recipient: '同事', goal: '测试' })
  ).data
  const selection = (
    await send<Selection>(`/api/projects/${p.id}/selections`, {
      name: '要求.md',
      base64: Buffer.from('你好😀\n<script>alert(1)</script>').toString('base64'),
    })
  ).data
  const imported = (
    await send<ImportResult>(`/api/projects/${p.id}/imports`, {
      token: selection.token,
      expectedRevision: 1,
      role: 'requirement',
      encoding: 'utf-8',
    })
  ).data
  const parsed = await send<ProjectDetail>(`/api/projects/${p.id}/parse`, {
    snapshotId: imported.file.id,
    expectedRevision: imported.project.revision,
  })
  expect(parsed.ok).toBe(true)
  expect(parsed.data.blocks[0].text).toBe('你好😀')
  const detail = (await send<ProjectDetail>(`/api/projects/${p.id}`)).data
  expect(detail.files).toHaveLength(1)
  expect(detail.project.activeRunId).toBe(null)
  expect(JSON.stringify(detail)).not.toContain('reading-club')
})
it('HTTP accepts the full 20 MiB limit and rejects malformed base64 without server errors', async () => {
  const app = await setup()
  const headers = { 'x-shouwei-request': 'local', 'content-type': 'application/json' }
  const created = await fetch(app.url + '/api/projects', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: '大文件', recipient: '', goal: '验证边界' }),
  })
  expect(created.status).toBe(201)
  const { data: project } = (await created.json()) as { data: Project }
  const upload = (base64: string) =>
    fetch(`${app.url}/api/projects/${project.id}/selections`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: '边界.txt', base64 }),
    })
  const valid = await upload(Buffer.alloc(20 * 1024 * 1024, 65).toString('base64'))
  expect(valid.status).toBe(201)
  expect(((await valid.json()) as { data: Selection }).data.token).toBeTruthy()
  for (const invalid of ['a', '====', 'AA=A', 'AAA\n', '汉字==']) {
    expect((await upload(invalid)).status).toBe(400)
  }
  expect(
    (await upload(Buffer.alloc(20 * 1024 * 1024 + 1, 65).toString('base64'))).status,
  ).toBe(413)
})
