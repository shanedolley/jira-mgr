import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { counts, launch, logIn, notices, refuseNextEdit, releaseEdit } from './harness.js'

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

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: string | RegExp) => tree().getByRole('treeitem', { name })
const peek = () => window.getByRole('complementary', { name: 'Peek' })
const issuePage = () => window.getByRole('region', { name: 'Issue page' })
const props = () => issuePage().getByRole('complementary', { name: 'Properties' })
const peekPicker = (label: string) => peek().getByRole('button', { name: new RegExp(`^${label}:`) })
const option = (name: string) => window.getByRole('option', { name, exact: true })
const toasts = () => notices(window).getByRole('listitem')
const live = () => window.getByRole('status', { name: 'Notice' })

const writes = async () => (await counts(app)).edits

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
}

/** Picks a Priority in the Peek of the issue whose row matches. The fake holds the edit until released. */
async function pickPriority(row: RegExp, name: string) {
  await item(row).click()
  await expect(peek()).toBeVisible()
  await peekPicker('Priority').click()
  await option(name).click()
}

/** Lets the fake answer the edit it holds, then waits for the issue's re-read to land. */
async function settle(expected: number) {
  await expect.poll(writes).toBe(expected)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(expected)
}

/** Slows the renderer, as a busy CI runner does. */
async function throttle(rate: number) {
  const session = await window.context().newCDPSession(window)
  await session.send('Emulation.setCPUThrottlingRate', { rate })
}

/**
 * Records what gains `data-flash`, which the 1s flash is made of: a Tree row by its id, and a
 * property row as "peek:<field>" or "page:<field>".
 */
async function watchFlash() {
  await window.evaluate(() => {
    const seen: string[] = []
    ;(window as unknown as { flashed: string[] }).flashed = seen
    new MutationObserver((changes) => {
      for (const { target } of changes) {
        if (!(target instanceof Element) || !target.hasAttribute('data-flash')) continue
        const field = target.getAttribute('data-field')
        if (field === null) seen.push(target.id)
        else seen.push(`${target.closest('[aria-label="Properties"]') ? 'page' : 'peek'}:${field}`)
      }
    }).observe(document.body, { attributes: true, attributeFilter: ['data-flash'], subtree: true })
  })
}

const flashed = () => window.evaluate(() => (window as unknown as { flashed: string[] }).flashed)

for (const rate of [1, 10]) {
  test.describe(`at ${String(rate)}x CPU slowdown`, () => {
    test.beforeEach(async () => {
      await open()
      if (rate > 1) await throttle(rate)
    })

    test('a refused priority edit says why in a toast, with no request, and flashes the row', async () => {
      await watchFlash()
      await pickPriority(/PSAPAC-3,/, 'Highest')
      await expect(peekPicker('Priority')).toHaveAccessibleName('Priority: Highest')
      await expect.poll(writes).toBe(1)
      await releaseEdit(app)

      const alert = notices(window).getByRole('alert')
      await expect(alert.locator('p')).toHaveText(
        'Priority not changed. Jira refused it: priority: The fake refuses this priority. Fix the input and try again.',
      )
      expect(await alert.innerText()).not.toMatch(/\/rest\/|\b(GET|PUT|POST|DELETE)\b/)
      await expect(peekPicker('Priority')).toHaveAccessibleName('Priority: Medium')
      // The old inline message under the properties is gone.
      await expect(peek().getByRole('alert')).toHaveCount(0)
      expect(await flashed()).toContain('tree-row-i:PSAPAC-3')
      expect(await flashed()).toContain('peek:priority')
    })

    test('a pending priority edit shows at 60% opacity with a spinner, and settles to full', async () => {
      await pickPriority(/PSAPAC-4,/, 'Low')
      await expect.poll(writes).toBe(1)

      const value = peek().locator('dd', {
        has: window.getByRole('button', { name: /^Priority:/ }),
      })
      await expect(value).toHaveAttribute('data-pending', 'true')
      await expect(value.locator('[data-spinner]')).toBeVisible()
      await expect(peekPicker('Priority')).toHaveAccessibleName('Priority: Low')
      const opacity = (label: string) =>
        peekPicker(label).evaluate((button) => getComputedStyle(button).opacity)
      expect(await opacity('Priority')).toBe('0.6')
      expect(await opacity('Status')).toBe('1')

      await releaseEdit(app)
      await expect(value).not.toHaveAttribute('data-pending')
      await expect(value.locator('[data-spinner]')).toHaveCount(0)
      expect(await opacity('Priority')).toBe('1')
    })
  })
}

test('the page shows a pending edit the same way', async () => {
  await open()
  await item(/PSAPAC-4,/).click()
  await window.keyboard.press('Enter')
  await expect(issuePage()).toBeVisible()
  await props()
    .getByRole('button', { name: /^Priority:/ })
    .click()
  await option('Low').click()
  await expect.poll(writes).toBe(1)

  const value = props().locator('[data-pending]')
  await expect(value).toHaveCount(1)
  await expect(value.locator('[data-spinner]')).toBeVisible()
  const dimmed = value.locator('> :not([data-spinner])').first()
  expect(await dimmed.evaluate((el) => getComputedStyle(el).opacity)).toBe('0.6')
  await releaseEdit(app)
  await expect(props().locator('[data-pending]')).toHaveCount(0)
})

test('on the page the refused property row flashes too', async () => {
  await open()
  await item(/PSAPAC-3,/).click()
  await window.keyboard.press('Enter')
  await expect(issuePage()).toBeVisible()
  await watchFlash()
  await props()
    .getByRole('button', { name: /^Priority:/ })
    .click()
  await option('Highest').click()
  await expect.poll(writes).toBe(1)
  await releaseEdit(app)
  await expect(notices(window).getByRole('alert')).toBeVisible()
  expect(await flashed()).toContain('page:priority')
})

test('the row flash is a 1s animation on the Tree row', async () => {
  await open()
  const animation = await item(/PSAPAC-3,/).evaluate((row) => {
    row.setAttribute('data-flash', '')
    const { animationName, animationDuration } = getComputedStyle(row)
    row.removeAttribute('data-flash')
    return `${animationName} ${animationDuration}`
  })
  expect(animation).toBe('flash 1s')
})

test('a refusal still shows when the Peek has moved on to another issue, and Retry sends it again', async () => {
  await open()
  await pickPriority(/PSAPAC-3,/, 'Highest')
  await expect.poll(writes).toBe(1)
  // The Peek follows the row, so PSAPAC-3's pickers are gone before Jira answers.
  await item(/PSAPAC-2,/).click()
  await expect(peek().getByText('PSAPAC-2')).toBeVisible()
  await releaseEdit(app)

  const alert = notices(window).getByRole('alert')
  await expect(alert).toContainText('Priority not changed. Jira refused it:')
  await alert.getByRole('button', { name: 'Retry' }).click()
  // The refused notice leaves, and the same edit goes out again.
  await expect.poll(writes).toBe(2)
  await releaseEdit(app)
  await expect(alert).toContainText('Priority not changed. Jira refused it:')
  await expect(toasts()).toHaveCount(1)
})

test('Retry refuses to overwrite a later edit of the same field', async () => {
  await open()
  await refuseNextEdit(app)
  await pickPriority(/PSAPAC-4,/, 'Low')
  await expect.poll(writes).toBe(1)
  await releaseEdit(app)
  const alert = notices(window).getByRole('alert')
  await expect(alert).toContainText('Priority not changed.')
  await expect(peekPicker('Priority')).toHaveAccessibleName('Priority: Medium')

  // A later edit of the same field goes through, so Retry's Low would silently replace it.
  await peekPicker('Priority').click()
  await option('High').click()
  await expect.poll(writes).toBe(2)
  await releaseEdit(app)
  // The refused edit applied nothing, so this is the first write the fake applied.
  await expect.poll(async () => (await counts(app)).applied).toBe(1)
  await expect(peekPicker('Priority')).toHaveAccessibleName('Priority: High')

  await alert.getByRole('button', { name: 'Retry' }).click()
  const warning = notices(window).getByRole('alert')
  await expect(warning).toContainText('Did not retry the Priority of PSAPAC-4')
  await expect(warning).toContainText(
    'Its priority changed since, and the retry would overwrite that.',
  )
  await expect(warning.getByRole('button', { name: 'Retry' })).toHaveCount(0)
  // Nothing was sent, and the later edit stands.
  expect(await writes()).toBe(2)
  await expect(peekPicker('Priority')).toHaveAccessibleName('Priority: High')
})

test('Retry refuses to overwrite an edit that was queued behind the refused one', async () => {
  await open()
  await refuseNextEdit(app)
  await pickPriority(/PSAPAC-4,/, 'Low')
  await expect.poll(writes).toBe(1)
  // High waits for Jira to answer Low, since edits of one issue go out one at a time.
  await peekPicker('Priority').click()
  await option('High').click()
  await expect(peekPicker('Priority')).toHaveAccessibleName('Priority: High')
  await releaseEdit(app)
  const alert = notices(window).getByRole('alert')
  await expect(alert).toContainText('Priority not changed.')
  await expect.poll(writes).toBe(2)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(1)
  await expect(peekPicker('Priority')).toHaveAccessibleName('Priority: High')

  // By now the cache shows High, which is not what Low's edit found, so Retry must not send Low.
  await alert.getByRole('button', { name: 'Retry' }).click()
  await expect(notices(window).getByRole('alert')).toContainText(
    'Did not retry the Priority of PSAPAC-4',
  )
  expect(await writes()).toBe(2)
  await expect(peekPicker('Priority')).toHaveAccessibleName('Priority: High')
})

test('Undo stays reachable on the last two toasts, each undoing its own edit', async () => {
  await open()
  await pickPriority(/PSAPAC-4,/, 'Low')
  await settle(1)
  await peekPicker('Assignee').click()
  await window.getByRole('combobox', { name: 'Search Assignee' }).pressSequentially('cy')
  await option('Cy Young').click()
  await settle(2)

  await expect(toasts()).toHaveCount(2)
  await expect(toasts().nth(0)).toContainText('PSAPAC-4: priority changed to Low')
  await expect(toasts().nth(1)).toContainText('PSAPAC-4: assignee changed to Cy Young')
  await expect(toasts().getByRole('button', { name: 'Undo' })).toHaveCount(2)

  // The older toast undoes the priority and leaves the assignee alone.
  await toasts().nth(0).getByRole('button', { name: 'Undo' }).click()
  await expect(peekPicker('Priority')).toHaveAccessibleName('Priority: Medium')
  await expect(peekPicker('Assignee')).toHaveAccessibleName('Assignee: Cy Young')
  await settle(3)
  await expect(toasts()).toHaveCount(2)
  await expect(toasts().nth(0)).toContainText('PSAPAC-4: assignee changed to Cy Young')
  await expect(toasts().nth(1)).toContainText('Undid PSAPAC-4: priority back to Medium')

  // The assignee toast kept its Undo.
  await toasts().nth(0).getByRole('button', { name: 'Undo' }).click()
  await expect(peekPicker('Assignee')).toHaveAccessibleName('Assignee: Test User')
  await settle(4)
  await expect(toasts().getByRole('button', { name: 'Undo' })).toHaveCount(0)
})

test('a live region announces each plain notice, and a refusal announces itself as an alert', async () => {
  await open()
  // The region is there, empty, before any notice.
  await expect(live()).toHaveText('')
  await expect(live()).toHaveCount(1)

  await pickPriority(/PSAPAC-4,/, 'Low')
  await settle(1)
  await expect(live()).toHaveText('PSAPAC-4: priority changed to Low.')
  // The toast itself is not the live region, so its buttons are not read out with it.
  await expect(notices(window).getByRole('status')).toHaveCount(0)

  await window.keyboard.press('Meta+z')
  await settle(2)
  await expect(live()).toHaveText('Undid PSAPAC-4: priority back to Medium.')

  await peekPicker('Priority').click()
  await option('Highest').click()
  await expect.poll(writes).toBe(3)
  await releaseEdit(app)
  await expect(notices(window).getByRole('alert')).toBeVisible()
  // The alert says it once; the region keeps what it last said.
  await expect(live()).toHaveText('Undid PSAPAC-4: priority back to Medium.')
})

test('a toast keeps its time while the pointer or focus is on it, then goes 5s after', async () => {
  await open()
  await window.clock.install()
  await pickPriority(/PSAPAC-4,/, 'Low')
  await settle(1)
  const toast = () => toasts().filter({ hasText: 'priority changed to Low' })
  await expect(toast()).toBeVisible()

  // Hovered, it outlasts the 10s a plain notice gets.
  await toast().hover()
  await window.clock.runFor(30_000)
  await expect(toast()).toBeVisible()
  // Leaving restarts the clock at 5s.
  await window.mouse.move(700, 300)
  await window.clock.runFor(4_900)
  await expect(toast()).toBeVisible()
  await window.clock.runFor(200)
  await expect(toast()).toHaveCount(0)

  // Focus holds it the same way.
  await peekPicker('Priority').click()
  await option('Medium').click()
  await settle(2)
  const next = toasts().filter({ hasText: 'priority changed to Medium' })
  await expect(next).toBeVisible()
  await next.getByRole('button', { name: 'Undo' }).focus()
  await window.clock.runFor(30_000)
  await expect(next).toBeVisible()
  await next.getByRole('button', { name: 'Undo' }).blur()
  await window.clock.runFor(5_100)
  await expect(next).toHaveCount(0)
})

test('a refusal stays until dismissed', async () => {
  await open()
  await window.clock.install()
  await pickPriority(/PSAPAC-3,/, 'Highest')
  await expect.poll(writes).toBe(1)
  await releaseEdit(app)
  const alert = notices(window).getByRole('alert')
  await expect(alert).toBeVisible()
  await window.clock.runFor(120_000)
  await expect(alert).toBeVisible()
  await alert.getByRole('button', { name: 'Dismiss' }).click()
  await expect(alert).toHaveCount(0)
})
