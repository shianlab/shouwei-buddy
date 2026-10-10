import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLocalServer } from './server.js'
const dataDir =
  process.env.SHOUWEI_DATA_DIR ??
  (process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'Shouwei Buddy')
    : process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? homedir(), 'Shouwei Buddy')
      : join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'shouwei-buddy'))
const port = Number(process.env.SHOUWEI_PORT ?? 4317)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local port')
const app = await createLocalServer({
  dataDir: resolve(dataDir),
  port,
  webRoot: process.env.SHOUWEI_WEB_ROOT ??
    (process.env.SHOUWEI_API_ONLY === '1'
      ? undefined
      : fileURLToPath(new URL('../../web/dist', import.meta.url))),
  devOrigin: process.env.SHOUWEI_API_ONLY === '1' ? 'http://127.0.0.1:4317' : undefined,
})
console.log(`收尾搭子已启动：${app.url}\n数据保存在：${dataDir}\n仅监听本机；停止请按 Ctrl+C。`)
let stopping = false
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    if (stopping) return
    stopping = true
    void app.close().then(() => process.exit(0))
  })
