import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: '**/._*',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 5000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4327',
    viewport: { width: 1440, height: 960 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: 'http://127.0.0.1:4327',
    reuseExistingServer: false,
    timeout: 30000,
  },
})
