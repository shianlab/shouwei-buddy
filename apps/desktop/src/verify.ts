import { app, BrowserWindow, ipcMain } from 'electron'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ModelConnection } from '@shouwei/contracts'
import { buildRuntimeLaunch, RuntimeManager } from '@shouwei/harness-adapter'

const connection: ModelConnection = {
  id: 'electron-verify', displayName: 'Electron 验证连接', protocol: 'openai-chat',
  baseUrl: 'http://127.0.0.1:9/v1', modelId: 'test-model', credentialRef: null,
  contextWindow: 64000, maxOutputTokens: 4096, requestTimeoutMs: 120000,
  capabilities: { text: 'untested', stream: 'untested', jsonMode: 'untested', tools: 'untested', vision: 'untested', usage: 'untested' },
}

async function verifyRuntime(): Promise<void> {
  const runRoot = await mkdtemp(join(tmpdir(), 'shouwei-electron-verify-'))
  const manager = new RuntimeManager()
  try {
    const launch = await buildRuntimeLaunch(connection, null, join(runRoot, 'r'), 'verify')
    await manager.acquire('verify', launch)
    const stopResult = await manager.stop()
    if (!stopResult.confirmed) throw new Error('runtime stop unconfirmed')
  } finally {
    const stop = await manager.stop()
    if (stop.confirmed) await rm(runRoot, { recursive: true, force: true })
  }
}

async function verifyWindow(): Promise<void> {
  const currentDir = dirname(fileURLToPath(import.meta.url))
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: false, preload: join(currentDir, 'preload.js') },
  })
  ipcMain.handle('app:ping', () => 'pong')
  try {
    await window.loadFile(join(currentDir, 'renderer/index.html'))
    const reply: unknown = await window.webContents.executeJavaScript('window.shouwei.ping()')
    if (reply !== 'pong') throw new Error('renderer IPC did not return pong')
  } finally {
    window.destroy()
    ipcMain.removeHandler('app:ping')
  }
}

const watchdog = setTimeout(() => { console.error('[verify] timed out'); app.exit(1) }, 45000)
app.whenReady().then(async () => {
  try {
    await verifyRuntime()
    await verifyWindow()
    console.log(`[verify] Electron ${process.versions.electron}, Node ${process.versions.node}, ABI ${process.versions.modules}: SDK start/stop + HTML/preload/IPC OK`)
    clearTimeout(watchdog)
    app.exit(0)
  } catch (error) {
    console.error('[verify] failed:', error)
    clearTimeout(watchdog)
    app.exit(1)
  }
})
