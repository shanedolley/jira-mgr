import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { _electron as electron, expect, test } from '@playwright/test'

// `pnpm package` writes this app. CI runs Linux, where it cannot be built, so the test skips.
const bundle = fileURLToPath(new URL('../../apps/desktop/dist/jira-mgr.app', import.meta.url))
const binary = join(bundle, 'Contents', 'MacOS', 'Electron')

test.skip(!existsSync(binary), 'run `pnpm package` first (macOS only)')

test('the packaged app opens on the login screen, with no Jira call', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'jm-pkg-'))
  const app = await electron.launch({
    executablePath: binary,
    // The packaged app never calls setPath, so Chromium would write its cache to the real state folder.
    args: [`--user-data-dir=${join(stateDir, 'electron')}`],
    env: { ...process.env, JM_STATE_DIR: stateDir },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByRole('heading', { name: 'Log in to Jira' })).toBeVisible()
  } finally {
    await app.close()
    await rm(stateDir, { recursive: true, force: true })
  }
})
