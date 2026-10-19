import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { counts, launch, logIn, peekRow } from './harness.js'

let app: ElectronApplication
let window: Page
let stateDir: string

test.beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'jm-e2e-'))
  ;({ app, window } = await launch(stateDir))
})

test.afterEach(async () => {
  await app.close()
  await rm(stateDir, { recursive: true, force: true })
})

test('shows a profile image, and initials when there is none or it fails to load', async () => {
  await logIn(window)
  const tree = window.getByRole('tree', { name: 'Issues' })

  // Test User has an image: main fetched it and the renderer shows it as a blob.
  const withImage = tree.getByRole('treeitem', { name: /Test User/ }).first()
  await expect(withImage.locator('img[data-avatar="image"]')).toHaveAttribute('src', /^blob:/)

  // Other User names an image the host lacks, so the row shows initials.
  const failed = tree.getByRole('treeitem', { name: /Other User/ }).first()
  await expect(failed.locator('[data-avatar="initials"]')).toHaveText('OU')

  // The signed-in user's image shows in the sidebar.
  const sidebar = window.getByRole('navigation', { name: 'Main' })
  await expect(sidebar.locator('img[data-avatar="image"]')).toHaveAttribute('src', /^blob:/)

  // One fetch per URL however many places show it, and none carried credentials.
  const { avatarFetches } = await counts(app)
  const urls = avatarFetches.map((f) => f.url)
  expect(new Set(urls).size).toBe(urls.length)
  expect(urls.sort()).toEqual([
    'https://avatars.fake.atl-paas.net/gone/48',
    'https://avatars.fake.atl-paas.net/u1/48',
  ])
  expect(avatarFetches.every((f) => !f.authorized)).toBe(true)

  await window.screenshot({ path: process.env.JM_AVATAR_SHOT ?? join(stateDir, 'avatars.png') })
})

test('the assignee picker shows an image, a failed image and no image', async () => {
  await logIn(window)
  await peekRow(
    window.getByRole('tree', { name: 'Issues' }).getByRole('treeitem', { name: /PSAPAC-3,/ }),
  )
  const peek = window.getByRole('complementary', { name: 'Peek' })
  await peek.getByRole('button', { name: /Assignee/ }).click()

  const option = (name: RegExp) => window.getByRole('option', { name })
  await expect(option(/Me/).locator('img[data-avatar="image"]')).toBeVisible()
  await window.getByRole('combobox', { name: 'Search Assignee' }).pressSequentially('cy')
  await expect(option(/Cy Young/).locator('[data-avatar="initials"]')).toHaveText('CY')
})
