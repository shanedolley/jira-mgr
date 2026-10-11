/// <reference lib="dom" />
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'

import { counts, launch, logIn, notices, releaseEdit } from './harness.js'

let app: ElectronApplication
let window: Page
let stateDir: string

test.beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'jm-e2e-'))
  ;({ app, window } = await launch(stateDir))
})

test.afterEach(async () => {
  await window
    .evaluate(() => {
      globalThis.onbeforeunload = null
    })
    .catch(() => undefined)
  await app.close()
  await rm(stateDir, { recursive: true, force: true })
})

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: string | RegExp) => tree().getByRole('treeitem', { name })
const peek = () => window.getByRole('complementary', { name: 'Peek' })
const issuePage = () => window.getByRole('region', { name: 'Issue page' })
const section = (name: string) => issuePage().getByRole('region', { name })

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
}

async function openPage(row: RegExp, title: string) {
  await open()
  await item(row).click()
  await window.keyboard.press('Enter')
  await expect(issuePage().getByRole('heading', { name: title })).toBeVisible()
  await expect(section('Activity').getByText('Loading comments')).toHaveCount(0)
  await expect(section('Attachments').getByText('Loading attachments')).toHaveCount(0)
}

/** PSAPAC-1 holds two comments (one the signed-in user's), two links and two attachments. */
const openStory = () => openPage(/PSAPAC-1,/, 'Kick off the engagement')
/** PSAPAC-2 holds two worklogs, one by the signed-in user. */
const openLogged = () => openPage(/PSAPAC-2,/, 'Review the data model')

/**
 * A button that fills a row, opens a property picker or is a bare text link is not button chrome:
 * a picker is a field, as a select is, and the rest take their shape from the row around them.
 */
const NOT_CHROME = '[aria-haspopup="listbox"], [data-row]'

const BIN = 'M3.5 4.5h9M6.5 4.5v-1h3v1M5 4.5l.5 8h5l.5-8'
const CROSS = ['m4 4 8 8M12 4l-8 8', 'm4.5 4.5 7 7m0-7-7 7']

interface Audit {
  seen: number
  bad: string[]
}

/** Every rendered button with chrome: its height is 24 or 28, its radius 6, and it is a `.btn`. */
const audit = (): Promise<Audit> =>
  window.evaluate(
    ([exempt, crosses]) => {
      const bad: string[] = []
      let seen = 0
      for (const button of document.querySelectorAll('button')) {
        if (button.matches(exempt)) continue
        const box = button.getBoundingClientRect()
        if (box.width === 0 && box.height === 0) continue
        seen++
        const name = button.getAttribute('aria-label') ?? button.textContent.trim()
        const style = getComputedStyle(button)
        const radii = [
          style.borderTopLeftRadius,
          style.borderTopRightRadius,
          style.borderBottomRightRadius,
          style.borderBottomLeftRadius,
        ]
        if (!button.classList.contains('btn')) bad.push(`${name}: not a .btn`)
        if (![24, 28].some((height) => Math.abs(box.height - height) < 0.5))
          bad.push(`${name}: ${String(box.height)}px high`)
        if (radii.some((radius) => radius !== '6px')) bad.push(`${name}: radius ${radii.join(' ')}`)
      }
      // Only a toast's Dismiss and a filter chip's Remove draw a cross: neither deletes data.
      for (const button of document.querySelectorAll('button')) {
        const name = button.getAttribute('aria-label') ?? button.textContent.trim()
        const drawn = [...button.querySelectorAll('path')].some((path) =>
          crosses.includes(path.getAttribute('d') ?? ''),
        )
        const typed = ['x', '×', '✕'].includes(name.toLowerCase())
        if ((drawn || typed) && !/^(Dismiss|Remove .* filter)$/.test(name))
          bad.push(`${name}: a cross`)
      }
      return { seen, bad }
    },
    [NOT_CHROME, CROSS] as const,
  )

/** Checks the buttons on screen now, and again with every font swapped for a wide one. */
async function expectSystem(where: string, minimum: number) {
  const narrow = await audit()
  expect(narrow.bad, where).toEqual([])
  expect(narrow.seen, `${where}: buttons measured`).toBeGreaterThanOrEqual(minimum)

  const style = await window.addStyleTag({
    content: '* { font-family: Verdana, sans-serif !important }',
  })
  const wide = await audit()
  await style.evaluate((node) => {
    node.parentNode?.removeChild(node)
  })
  expect(wide.bad, `${where} in Verdana`).toEqual([])
}

const colourOf = (button: Locator) => button.evaluate((element) => getComputedStyle(element).color)
/** The opacity a viewer sees: the element's own times every ancestor's. */
const opacityOf = (target: Locator) =>
  target.evaluate((element) => {
    let seen = 1
    for (let node: Element | null = element; node; node = node.parentElement)
      seen *= Number(getComputedStyle(node).opacity)
    return seen
  })

/** What `--danger` computes to, as a `color` value. */
const danger = () =>
  window.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--danger)'
    document.body.append(probe)
    const { color } = getComputedStyle(probe)
    probe.remove()
    return color
  })

test.describe('button system', () => {
  test('the login button is 28px high with a 6px radius', async () => {
    await expect(window.getByRole('button', { name: 'Log in' })).toBeVisible()
    await expectSystem('login', 1)
  })

  test('every button in the list, the Peek, the menus and the dialogs is 24 or 28px with a 6px radius', async () => {
    await open()
    await expectSystem('list', 8)

    await item(/PSAPAC-4,/).click()
    await expect(peek().getByRole('button', { name: 'Start timer' })).toBeVisible()
    await expectSystem('peek', 12)

    await window.getByRole('button', { name: 'Groups', exact: true }).click()
    await expect(window.getByRole('button', { name: 'Collapse all' })).toBeVisible()
    await expectSystem('groups menu', 12)
    await window.keyboard.press('Escape')

    await window.getByLabel('Filter by key or summary').fill('dashboards')
    await expect(window.getByRole('button', { name: 'Clear', exact: true })).toBeVisible()
    await expectSystem('filter row', 12)
    await window.getByLabel('Filter by key or summary').fill('')

    await window.keyboard.press('Escape')
    await window.keyboard.press('?')
    const help = window.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(help).toBeVisible()
    await expectSystem('shortcuts', 1)
    await help.getByRole('button', { name: 'Close' }).click()

    await window.getByRole('button', { name: 'New issue' }).click()
    const create = window.getByRole('dialog', { name: 'New issue' })
    await expect(create).toBeVisible()
    await create.locator('input[type="file"]').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello'),
    })
    await expect(create.getByRole('button', { name: 'Remove notes.txt' })).toBeVisible()
    await expectSystem('create dialog', 3)
    await create.getByRole('button', { name: 'Cancel' }).click()

    await item(/PSAPAC-4,/).click()
    await peek().getByRole('button', { name: 'Delete' }).click()
    const confirm = window.getByRole('dialog', { name: /Delete/ })
    await expect(confirm).toBeVisible()
    await expectSystem('delete dialog', 2)
  })

  test('every button on the issue page, its forms and its confirms is 24 or 28px with a 6px radius', async () => {
    await openStory()
    await expectSystem('page', 10)

    await section('Links').getByRole('button', { name: 'Add link' }).click()
    await expect(section('Links').getByRole('form', { name: 'Add link' })).toBeVisible()
    await expectSystem('add link form', 10)
    await section('Links').getByRole('button', { name: 'Cancel' }).click()

    const activity = section('Activity')
    await activity.getByRole('button', { name: 'Delete comment' }).click()
    await expect(activity.getByRole('group', { name: 'Delete comment' })).toBeVisible()
    await expectSystem('comment confirm', 10)
    await activity.getByRole('button', { name: 'Keep' }).click()

    await activity.getByRole('button', { name: 'Edit comment' }).click()
    await expect(activity.getByRole('textbox', { name: 'Comment by Test User' })).toBeFocused()
    await window.keyboard.type('!')
    await window.keyboard.press('Escape')
    await expect(window.getByRole('alertdialog')).toBeVisible()
    await expectSystem('discard dialog', 2)
  })

  test('the worklog form, its confirm and the timer dialog follow the system', async () => {
    await openLogged()
    await section('Worklogs').getByRole('button', { name: 'Add worklog' }).click()
    await expect(section('Worklogs').getByRole('form', { name: 'Add worklog' })).toBeVisible()
    await expectSystem('worklog form', 6)
    await section('Worklogs').getByRole('button', { name: 'Cancel' }).click()

    await section('Worklogs').getByRole('button', { name: 'Delete worklog' }).click()
    await expect(section('Worklogs').getByRole('group', { name: 'Delete worklog' })).toBeVisible()
    await expectSystem('worklog confirm', 6)
    await section('Worklogs').getByRole('button', { name: 'Keep' }).click()

    await issuePage().getByRole('button', { name: 'Start timer' }).click()
    await expect(issuePage().getByRole('button', { name: 'Stop timer' })).toBeVisible()
    await window.keyboard.press('t')
    const timer = window.getByRole('dialog', { name: 'Stop the timer on PSAPAC-2' })
    await expect(timer).toBeVisible()
    await expectSystem('timer dialog', 3)
  })

  test('a toast and its buttons follow the system, and the toast takes the 8px radius', async () => {
    await open()
    await item(/PSAPAC-4,/).click()
    await peek()
      .getByRole('button', { name: /^Priority:/ })
      .click()
    await window.getByRole('option', { name: 'Low' }).click()
    await expect.poll(async () => (await counts(app)).edits).toBe(1)
    await releaseEdit(app)
    const toast = notices(window).getByRole('listitem')
    await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible()
    await expectSystem('toast', 2)
    const radius = await toast
      .locator('> div')
      .evaluate((el) => getComputedStyle(el).borderTopLeftRadius)
    expect(radius).toBe('8px')
  })

  test('a dialog takes the 12px radius and a menu the 8px one', async () => {
    await open()
    await window.keyboard.press('Escape')
    await window.keyboard.press('?')
    const radius = (target: Locator) =>
      target.evaluate((element) => getComputedStyle(element).borderTopLeftRadius)
    expect(await radius(window.getByRole('dialog', { name: 'Keyboard shortcuts' }))).toBe('12px')
    await window.keyboard.press('Escape')

    await window.getByRole('button', { name: 'Groups', exact: true }).click()
    expect(await radius(window.getByRole('group', { name: 'Groups' }))).toBe('8px')
  })

  test('a disabled button is a line fill with muted text, not a faded accent', async () => {
    await openStory()
    const post = section('Activity').getByRole('button', { name: 'Comment', exact: true })
    await expect(post).toBeDisabled()
    const [fill, text] = await post.evaluate((element) => {
      const style = getComputedStyle(element)
      const probe = (value: string) => {
        const span = document.createElement('span')
        span.style.color = value
        document.body.append(span)
        const { color } = getComputedStyle(span)
        span.remove()
        return color
      }
      return [style.backgroundColor === probe('var(--line)'), style.color === probe('var(--muted)')]
    })
    expect([fill, text]).toEqual([true, true])
    expect(await opacityOf(post)).toBe(1)
  })
})

test.describe('section headings', () => {
  test('Links, Worklogs and Attachments add with a 24px "+" at the heading, and no Add text button remains', async () => {
    await openLogged()
    for (const [name, label] of [
      ['Links', 'Add link'],
      ['Worklogs', 'Add worklog'],
      ['Attachments', 'Attach file'],
    ] as const) {
      const region = section(name)
      const add = region.getByRole('button', { name: label })
      await expect(add).toHaveCount(1)
      await expect(add).toHaveText('')
      await expect(add.locator('svg')).toHaveCount(1)
      const box = await add.boundingBox()
      const heading = await region.getByRole('heading', { name, exact: true }).boundingBox()
      const frame = await region.boundingBox()
      expect(box?.width).toBe(24)
      expect(box?.height).toBe(24)
      // It sits on the heading's line, at the section's right edge.
      expect(
        Math.abs((box?.y ?? 0) + 12 - ((heading?.y ?? 0) + (heading?.height ?? 0) / 2)),
      ).toBeLessThan(3)
      expect(
        (frame?.x ?? 0) + (frame?.width ?? 0) - ((box?.x ?? 0) + (box?.width ?? 0)),
      ).toBeLessThan(2)
    }
  })

  test('the "+" opens the form it opened before', async () => {
    await openStory()
    await section('Links').getByRole('button', { name: 'Add link' }).click()
    await expect(section('Links').getByRole('form', { name: 'Add link' })).toBeVisible()
    await expect(
      section('Links').getByRole('button', { name: 'Add link', exact: true }),
    ).toHaveCount(1)
  })
})

test.describe('delete controls', () => {
  test('a link is removed with a bin that shows on hover or focus, and turns red on hover only', async () => {
    await openStory()
    const row = section('Links').getByRole('listitem').first()
    const bin = row.getByRole('button', { name: /^Remove link to/ })
    await expect(bin).toHaveText('')
    await expect(bin.locator('path')).toHaveAttribute('d', BIN)

    await window.mouse.move(0, 0)
    expect(await opacityOf(bin)).toBe(0)
    const red = await danger()
    expect(await colourOf(bin)).not.toBe(red)

    await row.hover()
    await expect.poll(() => opacityOf(bin)).toBe(1)
    expect(await colourOf(bin)).not.toBe(red)
    await bin.hover()
    await expect.poll(() => colourOf(bin)).toBe(red)

    await window.mouse.move(0, 0)
    await expect.poll(() => opacityOf(bin)).toBe(0)
    await bin.focus()
    expect(await opacityOf(bin)).toBe(1)
  })

  test('comment and worklog actions show on hover or focus, and Delete is a ghost text button red only on hover', async () => {
    await openLogged()
    const red = await danger()

    const log = section('Worklogs').getByRole('listitem').filter({ hasText: 'Test User' })
    const del = log.getByRole('button', { name: 'Delete worklog' })
    await window.mouse.move(0, 0)
    expect(await opacityOf(del)).toBe(0)
    await log.hover()
    await expect.poll(() => opacityOf(del)).toBe(1)
    expect(await colourOf(del)).not.toBe(red)
    await del.hover()
    await expect.poll(() => colourOf(del)).toBe(red)
    expect(await del.evaluate((e) => getComputedStyle(e).borderTopColor)).toBe('rgba(0, 0, 0, 0)')

    await issuePage().getByRole('button', { name: 'Back to issues' }).click()
    await item(/PSAPAC-1,/).click()
    await window.keyboard.press('Enter')
    await expect(section('Activity').getByRole('listitem').first()).toBeVisible()
    const comment = section('Activity')
      .getByRole('listitem')
      .filter({ hasText: 'My first comment' })
    const remove = comment.getByRole('button', { name: 'Delete comment' })
    await window.mouse.move(0, 0)
    expect(await opacityOf(remove)).toBe(0)
    await comment.getByRole('button', { name: 'Edit comment' }).focus()
    expect(await opacityOf(remove)).toBe(1)
    await remove.hover()
    await expect.poll(() => colourOf(remove)).toBe(red)
  })

  test('the issue Delete is red only on hover on the page and in the Peek, and solid red in its confirm', async () => {
    await open()
    const red = await danger()
    await item(/PSAPAC-4,/).click()
    const inPeek = peek().getByRole('button', { name: 'Delete' })
    expect(await colourOf(inPeek)).not.toBe(red)
    await inPeek.hover()
    await expect.poll(() => colourOf(inPeek)).toBe(red)

    await window.keyboard.press('Enter')
    const onPage = issuePage().getByRole('button', { name: 'Delete', exact: true })
    await window.mouse.move(0, 0)
    expect(await colourOf(onPage)).not.toBe(red)
    await onPage.hover()
    await expect.poll(() => colourOf(onPage)).toBe(red)

    await onPage.click()
    const confirm = window.getByRole('button', { name: 'Delete issue' })
    await expect(confirm).toBeEnabled()
    await window.mouse.move(0, 0)
    await expect.poll(() => confirm.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(red)
  })

  test('a saved view and a staged file are removed with a bin, and a toast and a filter chip keep their cross', async () => {
    await open()
    // A saved view.
    await window.getByRole('button', { name: 'New view' }).click()
    await window.keyboard.type('Mine')
    await window.keyboard.press('Enter')
    const view = window.getByRole('button', { name: 'Delete view Mine' })
    await expect(view).toHaveText('')
    await expect(view.locator('path')).toHaveAttribute('d', BIN)

    // A file staged in the create dialog.
    await window.getByRole('button', { name: 'New issue' }).click()
    const create = window.getByRole('dialog', { name: 'New issue' })
    await create.locator('input[type="file"]').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello'),
    })
    const staged = create.getByRole('button', { name: 'Remove notes.txt' })
    await expect(staged.locator('path')).toHaveAttribute('d', BIN)
    await expect(create).not.toContainText('×')
    await create.getByRole('button', { name: 'Cancel' }).click()

    // A filter chip keeps its cross.
    await window.getByRole('button', { name: 'Filter', exact: true }).click()
    await window.getByText('Status', { exact: true }).click()
    await window.getByRole('checkbox', { name: 'In Progress' }).check()
    await window.keyboard.press('Escape')
    const chip = window.getByRole('button', { name: 'Remove Status filter' })
    await expect(chip.locator('path')).toHaveAttribute('d', CROSS[1] ?? '')
  })
})
