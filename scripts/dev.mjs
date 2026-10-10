import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const api = spawn(process.execPath, ['apps/server/lib/main.js'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, SHOUWEI_PORT: '4318', SHOUWEI_API_ONLY: '1' },
})
const web = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4317', '--strictPort'],
  { cwd: fileURLToPath(new URL('../apps/web', import.meta.url)), stdio: 'inherit' },
)
let stopping = false
async function stop(code = 0) {
  if (stopping) return
  stopping = true
  await Promise.all(
    [api, web].map((child) =>
      child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => {
            child.once('exit', resolve)
            child.kill('SIGTERM')
          }),
    ),
  )
  process.exit(code)
}
for (const child of [api, web]) {
  child.once('error', () => void stop(1))
  child.once('exit', (code) => void stop(code ?? 1))
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void stop())
