import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { _electron as electron, expect, test } from '@playwright/test'

// `pnpm package` writes this app. CI runs Linux, where it cannot be built, so the test skips.
const bundle = fileURLToPath(
  new URL('../../apps/desktop/dist/Jira Task Manager.app', import.meta.url),
)
const binary = join(bundle, 'Contents', 'MacOS', 'Electron')

test.skip(!existsSync(binary), 'run `pnpm package` first (macOS only)')

test('the bundle is named Jira Task Manager and keeps its identifier', () => {
  const plist = (key: string) =>
    execFileSync('/usr/libexec/PlistBuddy', [
      '-c',
      `Print ${key}`,
      join(bundle, 'Contents', 'Info.plist'),
    ])
      .toString()
      .trim()
  expect(plist('CFBundleName')).toBe('Jira Task Manager')
  expect(plist('CFBundleDisplayName')).toBe('Jira Task Manager')
  expect(plist('CFBundleIdentifier')).toBe('au.com.koinon.jira-mgr')
})

test('the packaged app opens on the login screen, with no Jira call', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'jm-pkg-'))
  const app = await electron.launch({
    executablePath: binary,
    env: { ...process.env, JM_STATE_DIR: stateDir },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByRole('heading', { name: 'Log in to Jira' })).toBeVisible()
    // The bundle name moved Electron's default data folder, so the app pins it to the state folder.
    expect(await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))).toBe(
      stateDir,
    )
    expect(await app.evaluate(({ app: electronApp }) => electronApp.name)).toBe('Jira Task Manager')
    expect(await window.title()).toBe('Jira Task Manager')
  } finally {
    await app.close()
    await rm(stateDir, { recursive: true, force: true })
  }
})
