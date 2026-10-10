export const APP_VERSION = '0.1.0-rc.1'
export interface SystemInfo {
  version: string
  platform: string
  arch: string
  nodeVersion: string
  dataDir: string
  distribution: 'source' | 'macos-test'
}
export interface Diagnostics {
  schema: 1
  generatedAt: string
  app: Omit<SystemInfo, 'dataDir'>
  storage: { schema: number; projects: number; snapshots: number; deliveries: number; activeRuns: number; cleanupPending: boolean }
  model: { configured: boolean; tested: boolean; busy: boolean; credentialStorage: string; needsCredential: boolean; restoreWarning: boolean; cleanupPending: boolean }
}
