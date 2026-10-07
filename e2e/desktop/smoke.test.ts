import { fileURLToPath } from 'node:url'

import { _electron as electron, expect, test } from '@playwright/test'

const desktopDir = fileURLToPath(new URL('../../apps/desktop', import.meta.url))

test('opens the main window', async () => {
  // GitHub's Linux runners lack the setuid sandbox helper, so CI runs without it.
  const app = await electron.launch({
    args: process.env.CI ? ['--no-sandbox', desktopDir] : [desktopDir],
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByRole('heading', { name: 'jira-mgr' })).toBeVisible()
  } finally {
    await app.close()
  }
})
