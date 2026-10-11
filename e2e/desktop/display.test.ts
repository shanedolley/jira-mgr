import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'

import { counts, launch, logIn, readState, releaseEdit } from './harness.js'

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

interface Display {
  properties: string[]
  order: string
}

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: RegExp) => tree().getByRole('treeitem', { name })
const peek = () => window.getByRole('complementary', { name: 'Peek' })
const displayButton = () => window.getByRole('button', { name: 'Display', exact: true })
const choice = (group: string, name: string) =>
  window.getByRole('group', { name: group, exact: true }).getByRole('button', { name, exact: true })
/** `Oct 4`, or `Oct 4 '25` in another year. The fake's day depends on the machine's time zone. */
const SHORT_DATE = /^[A-Z][a-z]{2} \d{1,2}( '\d{2})?$/
const prop = (key: RegExp, name: string) => item(key).locator(`[data-prop=${name}]`)

/** `display` in settings.json, which the login writes with the defaults. */
const savedDisplay = async () =>
  (await readState<{ display?: Display }>(stateDir, 'settings.json'))?.display
const savedViews = async () =>
  (await readState<{ id: string; name: string; display?: Display }[]>(stateDir, 'views.json')) ?? []

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
}

/** Opens the Display menu, runs `choose`, and closes it, which hands focus back to the Tree. */
async function inDisplayMenu(choose: () => Promise<void>) {
  await displayButton().click()
  await expect(window.getByRole('group', { name: 'Ordering', exact: true })).toBeVisible()
  await choose()
  await window.keyboard.press('Escape')
  await expect(window.getByRole('group', { name: 'Ordering', exact: true })).toBeHidden()
}

/** The issue keys of the rows in the DOM, top to bottom. */
const issueKeys = async () =>
  (
    await Promise.all(
      (await tree().getByRole('treeitem').all()).map(
        async (row) => /PSAPAC-\d+/.exec((await row.getAttribute('aria-label')) ?? '')?.[0],
      ),
    )
  ).filter((key) => key !== undefined)

const headers = async () =>
  Promise.all(
    (await tree().locator('[role=treeitem][aria-level="1"]').all()).map(
      async (row) => (await row.getAttribute('aria-label')) ?? '',
    ),
  )

/** Sets the priority of an issue by its picker: click the row, then P and the option's number. */
async function setPriority(key: RegExp, option: number) {
  const { edits } = await counts(app)
  await item(key).click()
  await window.keyboard.press('p')
  await expect(window.getByRole('listbox', { name: 'Priority' })).toBeFocused()
  await expect(window.getByRole('option', { name: /Low/ })).toBeVisible()
  await window.keyboard.press(String(option))
  await expect(window.getByRole('listbox')).toHaveCount(0)
  await expect.poll(async () => (await counts(app)).edits).toBe(edits + 1)
  // The fake holds the write until released, then moves the issue's `updated` on.
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(edits + 1)
  await expect(item(key).locator('[data-glyph=priority]')).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)
}

test('shows Updated by default, and each property appears on the rows and survives a restart', async () => {
  await open()
  const row = /PSAPAC-11,/
  await expect(prop(row, 'updated')).toHaveText(SHORT_DATE)
  for (const name of ['labels', 'sprint', 'due', 'created'])
    await expect(prop(row, name)).toHaveCount(0)
  expect(await savedDisplay()).toEqual({ properties: ['updated'], order: 'key' })

  await inDisplayMenu(async () => {
    await expect(choice('Display properties', 'Updated')).toHaveAttribute('aria-pressed', 'true')
    await expect(choice('Display properties', 'Labels')).toHaveAttribute('aria-pressed', 'false')
    await choice('Display properties', 'Labels').click()
    await choice('Display properties', 'Sprint').click()
    await choice('Display properties', 'Due date').click()
    await choice('Display properties', 'Created').click()
    await choice('Display properties', 'Updated').click()
  })

  await expect(prop(row, 'labels')).toHaveText('docs')
  await expect(prop(row, 'updated')).toHaveCount(0)
  await expect(prop(/PSAPAC-13,/, 'sprint')).toHaveText('Sprint 5')
  await expect(prop(row, 'created')).toHaveText(SHORT_DATE)
  // Far-off, past and missing due dates: grey, red, nothing.
  await expect(prop(/PSAPAC-31,/, 'due')).toHaveAttribute('data-tone', 'later')
  await expect(prop(/PSAPAC-31,/, 'due')).toContainText('Dec 31')
  await expect(prop(/PSAPAC-40,/, 'due')).toHaveAttribute('data-tone', 'overdue')
  await expect(prop(row, 'due')).not.toHaveAttribute('data-tone', /.+/)
  await expect.poll(savedDisplay).toEqual({
    properties: ['labels', 'sprint', 'due', 'created'],
    order: 'key',
  })

  // The fake Keychain lives in the process, so the relaunch logs in again.
  await app.close()
  ;({ app, window } = await launch(stateDir))
  await open()
  await expect(prop(row, 'labels')).toHaveText('docs')
  await expect(prop(/PSAPAC-13,/, 'sprint')).toHaveText('Sprint 5')
  await expect(prop(row, 'updated')).toHaveCount(0)
})

test('colours the due date icon red when overdue and grey when far off', async () => {
  await open()
  await inDisplayMenu(async () => {
    await choice('Display properties', 'Due date').click()
  })
  const icon = (key: RegExp) =>
    prop(key, 'due')
      .locator('svg')
      .evaluate((el) => getComputedStyle(el).color)
  const paint = (variable: string) =>
    window.evaluate((v) => {
      const probe = document.createElement('span')
      probe.style.color = `var(${v})`
      document.body.append(probe)
      const colour = getComputedStyle(probe).color
      probe.remove()
      return colour
    }, variable)
  // PSAPAC-40 fell due in 2020, and PSAPAC-31 falls due in 2999.
  expect(await icon(/PSAPAC-40,/)).toBe(await paint('--danger'))
  expect(await icon(/PSAPAC-31,/)).toBe(await paint('--muted'))
})

test('orders by due date within an Epic, keeping the Customer groups and No Epic', async () => {
  await open()
  const groups = ['Acme, 8 issues', 'Beta Ltd, 5 issues', 'Collibra (Internal team), 2 issues']
  await expect.poll(headers).toEqual(groups)
  expect((await issueKeys()).filter((k) => ['PSAPAC-31', 'PSAPAC-32'].includes(k))).toEqual([
    'PSAPAC-32',
    'PSAPAC-31',
  ])

  await inDisplayMenu(async () => {
    await expect(choice('Ordering', 'Key')).toHaveAttribute('aria-pressed', 'true')
    await choice('Ordering', 'Due date').click()
  })

  // PSAPAC-31 is due in 2999 and PSAPAC-32 has no date, which sorts last.
  await expect
    .poll(async () => (await issueKeys()).filter((k) => ['PSAPAC-31', 'PSAPAC-32'].includes(k)))
    .toEqual(['PSAPAC-31', 'PSAPAC-32'])
  expect(await headers()).toEqual(groups)
  // Each Epic still sits under its own Customer, and No Epic keeps its place after the Epics.
  const keys = await issueKeys()
  expect(keys.indexOf('PSAPAC-30')).toBeLessThan(keys.indexOf('PSAPAC-31'))
  expect(keys.indexOf('PSAPAC-40')).toBeGreaterThan(keys.indexOf('PSAPAC-32'))
  await expect.poll(savedDisplay).toEqual({ properties: ['updated'], order: 'due' })

  await inDisplayMenu(async () => {
    await choice('Ordering', 'Key').click()
  })
  await expect
    .poll(async () => (await issueKeys()).filter((k) => ['PSAPAC-31', 'PSAPAC-32'].includes(k)))
    .toEqual(['PSAPAC-32', 'PSAPAC-31'])
})

test('orders by priority and by updated within an Epic', async () => {
  await open()
  const acme = [
    'PSAPAC-10',
    'PSAPAC-11',
    'PSAPAC-12',
    'PSAPAC-3',
    'PSAPAC-2',
    'PSAPAC-13',
    'PSAPAC-4',
    'PSAPAC-1',
  ]
  const inAcme = async () => (await issueKeys()).slice(0, acme.length)
  expect(await inAcme()).toEqual(acme)

  // Both edits move `updated` on, PSAPAC-2 later than PSAPAC-3. Only the High one shows a glyph.
  await setPriority(/PSAPAC-3,/, 2)
  await setPriority(/PSAPAC-2,/, 4)
  await expect(item(/PSAPAC-11,/).locator('[data-glyph=priority]')).toHaveCount(0)
  await expect(item(/PSAPAC-3,/).locator('[data-glyph=priority]')).toHaveAttribute(
    'data-level',
    '3',
  )
  await expect(item(/PSAPAC-2,/).locator('[data-glyph=priority]')).toHaveAttribute(
    'data-level',
    '1',
  )

  await inDisplayMenu(async () => {
    await choice('Ordering', 'Priority').click()
  })
  // High first, then Medium by status and key, then Low. PSAPAC-12 stays under PSAPAC-11.
  await expect
    .poll(inAcme)
    .toEqual([
      'PSAPAC-10',
      'PSAPAC-3',
      'PSAPAC-11',
      'PSAPAC-12',
      'PSAPAC-13',
      'PSAPAC-4',
      'PSAPAC-1',
      'PSAPAC-2',
    ])

  await inDisplayMenu(async () => {
    await choice('Ordering', 'Updated').click()
  })
  // Newest edit first, then the untouched ones by status and key.
  await expect
    .poll(inAcme)
    .toEqual([
      'PSAPAC-10',
      'PSAPAC-2',
      'PSAPAC-3',
      'PSAPAC-11',
      'PSAPAC-12',
      'PSAPAC-13',
      'PSAPAC-4',
      'PSAPAC-1',
    ])
  expect(await headers()).toEqual([
    'Acme, 8 issues',
    'Beta Ltd, 5 issues',
    'Collibra (Internal team), 2 issues',
  ])
})

test('a saved view carries its display, which applying copies and Update view saves', async () => {
  await open()
  const view = (name: string) =>
    window.getByRole('list', { name: 'Saved views' }).getByRole('button', { name, exact: true })
  const update = (name: string) =>
    window.getByRole('button', { name: `Update view ${name}`, exact: true })
  const row = /PSAPAC-11,/

  // Create a view with Labels and the Due date order showing.
  await inDisplayMenu(async () => {
    await choice('Display properties', 'Labels').click()
    await choice('Ordering', 'Due date').click()
  })
  await window.getByRole('button', { name: 'New view' }).click()
  await window.getByLabel('New view name').fill('Triage')
  await window.keyboard.press('Enter')
  await expect(view('Triage')).toHaveAttribute('aria-current', 'true')
  await expect
    .poll(async () => (await savedViews()).find((v) => v.name === 'Triage')?.display)
    .toEqual({ properties: ['labels', 'updated'], order: 'due' })

  // Display is not part of the match: toggling a property keeps the view lit, and Update view wakes.
  await expect(update('Triage')).toBeDisabled()
  await inDisplayMenu(async () => {
    await choice('Display properties', 'Sprint').click()
  })
  await expect(view('Triage')).toHaveAttribute('aria-current', 'true')
  await expect(update('Triage')).toBeEnabled()

  // A starter view holds no display, so applying it leaves the display as it is.
  await view('My issues').click()
  await expect(view('My issues')).toHaveAttribute('aria-current', 'true')
  await inDisplayMenu(async () => {
    await expect(choice('Display properties', 'Sprint')).toHaveAttribute('aria-pressed', 'true')
  })

  // Applying Triage puts its own display back: Labels and Updated, order by due date, no Sprint.
  await view('Triage').click()
  await expect(prop(row, 'labels')).toHaveText('docs')
  await expect(prop(row, 'sprint')).toHaveCount(0)
  await expect.poll(savedDisplay).toEqual({ properties: ['labels', 'updated'], order: 'due' })
  await inDisplayMenu(async () => {
    await expect(choice('Ordering', 'Due date')).toHaveAttribute('aria-pressed', 'true')
    await expect(choice('Display properties', 'Sprint')).toHaveAttribute('aria-pressed', 'false')
  })

  // Update view saves the current display into the view.
  await inDisplayMenu(async () => {
    await choice('Display properties', 'Labels').click()
    await choice('Display properties', 'Created').click()
    await choice('Ordering', 'Priority').click()
  })
  await expect(update('Triage')).toBeEnabled()
  await update('Triage').click()
  await expect(update('Triage')).toBeDisabled()
  await expect
    .poll(async () => (await savedViews()).find((v) => v.name === 'Triage')?.display)
    .toEqual({ properties: ['created', 'updated'], order: 'priority' })
  // The other views were not touched.
  expect((await savedViews()).find((v) => v.id === 'my-issues')?.display).toBeUndefined()
})

/** The sRGB luminance of a computed `rgb(...)` or `color(srgb ...)` colour. */
const luminance = (css: string) => {
  const parts = css.match(/[\d.]+/g)?.map(Number) ?? []
  const scale = css.startsWith('color(') ? 1 : 255
  const [r = 0, g = 0, b = 0] = parts.slice(0, 3).map((c) => c / scale)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const background = (el: Locator) => el.evaluate((node) => getComputedStyle(node).backgroundColor)

test('lays out 32px rows and 36px headers after an 8px gap, and the band reads lighter in dark', async () => {
  await window.emulateMedia({ colorScheme: 'dark' })
  await open()
  const boxes = await tree()
    .getByRole('treeitem')
    .evaluateAll((rows) =>
      rows.map((row) => {
        const box = row.getBoundingClientRect()
        return {
          level: row.getAttribute('aria-level'),
          top: box.top,
          height: box.height,
        }
      }),
    )
  const headerBoxes = boxes.filter((b) => b.level === '1')
  expect(headerBoxes.length).toBeGreaterThan(1)
  for (const box of boxes) expect(box.height).toBe(box.level === '1' ? 36 : 32)
  // The last row above a header ends 8px before the band starts.
  boxes.forEach((box, i) => {
    const before = boxes[i - 1]
    if (box.level === '1' && before !== undefined)
      expect(box.top - (before.top + before.height)).toBe(8)
  })

  const band = await background(item(/^Acme, /))
  const canvas = await background(window.locator('#issue-list'))
  expect(luminance(band)).toBeGreaterThan(luminance(canvas))
})

test('fits PSAPAC-12345 and every property in a wide font, with no row overflowing', async () => {
  await open()
  await inDisplayMenu(async () => {
    for (const name of ['Labels', 'Sprint', 'Due date', 'Created']) {
      await choice('Display properties', name).click()
    }
  })
  await expect(prop(/PSAPAC-11,/, 'labels')).toBeVisible()
  const style = await window.addStyleTag({
    content: '* { font-family: Verdana, "DejaVu Sans", sans-serif !important }',
  })
  const fits = await tree()
    .getByRole('treeitem')
    .evaluateAll((rows) => {
      const key = rows
        .find((row) => row.querySelector('.tree-key') !== null)
        ?.querySelector('.tree-key')
      if (key === null || key === undefined) return null
      // A five-digit key in the same box: the column grows to fit it rather than overflow.
      const text = key.textContent
      key.textContent = 'PSAPAC-12345'
      const keyFits = key.scrollWidth <= key.clientWidth
      const title = key.nextElementSibling?.getBoundingClientRect().left ?? 0
      const keyRight = key.getBoundingClientRect().right
      key.textContent = text
      return {
        keyFits,
        titleClear: title >= keyRight,
        overflowing: rows.filter((row) => row.scrollWidth > row.clientWidth).length,
        titles: rows
          .map(
            (row) =>
              row.querySelector('.tree-key')?.nextElementSibling?.getBoundingClientRect().width,
          )
          .filter((w) => w !== undefined)
          .every((w) => w > 80),
      }
    })
  await style.evaluate((node) => {
    node.parentNode?.removeChild(node)
  })
  expect(fits).toEqual({ keyFits: true, titleClear: true, overflowing: 0, titles: true })
})
