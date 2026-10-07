import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'desktop',
  reporter: process.env.CI ? 'github' : 'list',
})
