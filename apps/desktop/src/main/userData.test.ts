import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { DESKTOP_NAME } from '@jira-mgr/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { pinUserData } from './userData'

const root = join(__dirname, '../../../..')

describe('pinUserData', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('pins userData to the jira-mgr folder, whatever the app is called', () => {
    vi.stubEnv('JM_STATE_DIR', '')
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
    const setPath = vi.fn()
    pinUserData({ setPath })
    expect(setPath).toHaveBeenCalledWith(
      'userData',
      join(homedir(), 'Library', 'Application Support', 'jira-mgr'),
    )
  })

  it('lets JM_STATE_DIR win', () => {
    vi.stubEnv('JM_STATE_DIR', '/tmp/jm-test-state')
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
    const setPath = vi.fn()
    pinUserData({ setPath })
    expect(setPath).toHaveBeenCalledWith('userData', '/tmp/jm-test-state')
  })

  it('leaves `pnpm dev` alone', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    const setPath = vi.fn()
    pinUserData({ setPath })
    expect(setPath).not.toHaveBeenCalled()
  })
})

describe('the desktop name', () => {
  it('is Jira Task Manager', () => {
    expect(DESKTOP_NAME).toBe('Jira Task Manager')
  })

  it('titles the HTML page', () => {
    const html = readFileSync(join(__dirname, '../renderer/index.html'), 'utf8')
    expect(html).toContain(`<title>${DESKTOP_NAME}</title>`)
  })

  it('names the bundle that pnpm package writes', () => {
    const script = readFileSync(join(root, 'scripts/package.ts'), 'utf8')
    expect(script).toContain(`const DISPLAY_NAME = '${DESKTOP_NAME}'`)
    expect(script).toContain("['CFBundleName', DISPLAY_NAME]")
    expect(script).toContain("['CFBundleDisplayName', DISPLAY_NAME]")
    expect(script).toContain("['CFBundleIdentifier', ID]")
    expect(script).toContain("const ID = 'au.com.koinon.jira-mgr'")
  })

  it('pins userData at startup', () => {
    const entry = readFileSync(join(__dirname, 'index.ts'), 'utf8')
    expect(entry).toContain('pinUserData(app)')
  })

  it('gives the bundled package.json the product name', () => {
    const script = readFileSync(join(root, 'scripts/package.ts'), 'utf8')
    expect(script).toContain('productName: DISPLAY_NAME')
  })

  it('titles the window', () => {
    const app = readFileSync(join(__dirname, 'app.ts'), 'utf8')
    expect(app).toContain('title: DESKTOP_NAME')
  })

  it('leaves the CLI name alone', () => {
    const core = readFileSync(join(root, 'packages/core/src/index.ts'), 'utf8')
    expect(core).toContain("export const APP_NAME = 'jira-mgr'")
  })
})
