import { app, BrowserWindow, ipcMain } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: '收尾搭子',
    backgroundColor: '#F6F7F2',
    webPreferences: {
      // ESM preload 需要关闭沙箱；阶段 1 引入正式渲染构建时再复核。
      sandbox: false,
      preload: join(currentDir, 'preload.js'),
    },
  })
  void win.loadFile(join(currentDir, 'renderer/index.html'))
}

app.whenReady().then(() => {
  ipcMain.handle('app:ping', () => 'pong')
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
