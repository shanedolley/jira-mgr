import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import {
  counts,
  holdTextSearch,
  launch,
  logIn,
  releaseTextSearch,
  setDescription,
} from './harness.js'

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

const palette = () => window.getByRole('dialog', { name: 'Search issues' })
const search = () => palette().getByRole('combobox')
const jiraGroup = () => palette().getByRole('group', { name: 'Search text in Jira' })
const issuePage = () => window.getByRole('region', { name: 'Issue page' })
const doc = (text: string) => ({
  version: 1,
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

async function openPalette() {
  await logIn(window)
  await expect(window.getByRole('treeitem', { name: /PSAPAC-10,/ })).toBeVisible()
  await window.keyboard.press('Meta+k')
  await expect(palette()).toBeVisible()
}

/** The keys of the listed options, top to bottom. */
const listedKeys = async () =>
  (await palette().getByRole('option').allInnerTexts()).map((t) => /PSAPAC-\d+/.exec(t)?.[0])

test('a word only a description holds finds its issue, and Enter opens it', async () => {
  await logIn(window)
  await expect(window.getByRole('treeitem', { name: /PSAPAC-10,/ })).toBeVisible()
  await setDescription(app, 'PSAPAC-3', doc('The nightly quokka job stalls.'))
  await window.keyboard.press('Meta+k')
  await expect(palette()).toBeVisible()

  await search().fill('quokka')
  await expect(jiraGroup().getByRole('option')).toHaveCount(1)
  await expect(jiraGroup().getByRole('option')).toContainText('Fix the export timeout')
  await window.keyboard.press('Enter')
  await expect(issuePage().getByRole('heading', { name: 'Fix the export timeout' })).toBeVisible()
  expect((await counts(app)).textSearches).toEqual([{ query: 'quokka', aborted: false }])
})

test('a word only a comment holds finds its issue, and a click opens it', async () => {
  await openPalette()
  await search().fill('someone')
  await jiraGroup()
    .getByRole('option', { name: /PSAPAC-1\b/ })
    .click()
  await expect(issuePage().getByRole('heading', { name: 'Kick off the engagement' })).toBeVisible()
})

test('loaded matches rank first and Jira text matches follow without repeats', async () => {
  await logIn(window)
  await expect(window.getByRole('treeitem', { name: /PSAPAC-10,/ })).toBeVisible()
  await setDescription(app, 'PSAPAC-3', doc('The report export times out.'))
  await window.keyboard.press('Meta+k')
  await search().fill('report')

  await expect(jiraGroup().getByRole('option')).toHaveCount(1)
  // PSAPAC-3 matches by description only, so it is the one row below the loaded matches.
  expect(await listedKeys()).toEqual(['PSAPAC-30', 'PSAPAC-31', 'PSAPAC-32', 'PSAPAC-3'])
  await expect(palette().getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
  await expect(jiraGroup()).toContainText('1 more match')
})

test('a new query cancels the search in flight and only the new one answers', async () => {
  await logIn(window)
  await expect(window.getByRole('treeitem', { name: /PSAPAC-10,/ })).toBeVisible()
  await setDescription(app, 'PSAPAC-3', doc('The nightly quokka job stalls.'))
  await holdTextSearch(app)
  await window.keyboard.press('Meta+k')

  await search().fill('quokka')
  await expect.poll(async () => (await counts(app)).textSearches.length).toBe(1)
  await expect(jiraGroup()).toContainText('Searching')

  await search().fill('quokka job')
  await expect.poll(async () => (await counts(app)).textSearches.length).toBe(2)
  expect((await counts(app)).textSearches).toEqual([
    { query: 'quokka', aborted: true },
    { query: 'quokka job', aborted: false },
  ])

  await releaseTextSearch(app)
  await expect(jiraGroup()).toContainText('1 more match')
  await expect(jiraGroup().getByRole('option')).toHaveCount(1)
})

test('text shorter than three characters sends no search', async () => {
  await openPalette()
  await search().fill('qu')
  await window.waitForTimeout(600)
  await expect(jiraGroup()).toHaveCount(0)
  expect((await counts(app)).textSearches).toEqual([])
})
