import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalServer } from '../../apps/server/src/server.js'
it('delivery history requires local headers; strict delivery routes reject invalid cross-project artifacts and extra paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shouwei-delivery-api-')),
    app = await createLocalServer({ dataDir: root, port: 0 })
  const headers = { 'x-shouwei-request': 'local', 'content-type': 'application/json' }
  try {
    const history = await fetch(app.url + '/api/deliveries', { headers })
    expect(history.status).toBe(200)
    expect(((await history.json()) as {data:unknown}).data).toEqual([])
    expect((await fetch(app.url + '/api/deliveries')).status).toBe(403)
    const p = ((
      await (
        await fetch(app.url + '/api/projects', {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: 'API', recipient: '', goal: '交材料' }),
        })
      ).json()
    ) as {data:{id:string;revision:number}}).data
    const invalid = await fetch(app.url + `/api/projects/${p.id}/deliveries`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        expectedRevision: p.revision,
        files: [],
        note: '',
        requirementRisks: [],
        path: '/tmp/arbitrary',
      }),
    })
    expect(invalid.status).toBe(400)
    const absent = await fetch(
      app.url +
        `/api/projects/${p.id}/deliveries/05f85750-c3cf-4326-810d-3f70c747700b/download/zip`,
      { headers },
    )
    expect(absent.status).toBe(404)
    expect(
      (
        await fetch(app.url + '/api/deliveries', {
          headers: { ...headers, Origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403)
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})
