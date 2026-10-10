import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLocalServer } from '../apps/server/lib/server.js'
const root = await mkdtemp(join(tmpdir(), 'shouwei-e2e-'))
let app
try {
  app = await createLocalServer({
    dataDir: root,
    port: 4327,
    webRoot: fileURLToPath(new URL('../apps/web/dist', import.meta.url)),
  })
} catch (error) {
  await rm(root, { recursive: true, force: true })
  throw error
}
console.log('Isolated E2E server: ' + app.url)
let stopping = false
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, async () => {
    if (stopping) return
    stopping = true
    await app.close()
    await rm(root, { recursive: true, force: true })
    process.exit(0)
  })
