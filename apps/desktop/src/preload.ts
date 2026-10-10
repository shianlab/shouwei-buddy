import { contextBridge, ipcRenderer } from 'electron'

/** 阶段 0 类型化桥接占位：只验证主进程到渲染进程的往返。 */
interface ShouweiBridge {
  ping: () => Promise<string>
}

const bridge: ShouweiBridge = {
  ping: () => ipcRenderer.invoke('app:ping'),
}

contextBridge.exposeInMainWorld('shouwei', bridge)
