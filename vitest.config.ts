import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    exclude: ['**/._*', '**/node_modules/**', 'tests/e2e/**'],
    // dsh 子进程启动较慢，给集成测试留足时间。
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
