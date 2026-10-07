import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { setupFiles: ['@jira-mgr/core/test/setup', './src/test-setup.ts'] },
})
