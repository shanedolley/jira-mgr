/// <reference lib="dom" />
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'

import { counts, joinSprint, launch, logIn, releaseEdit } from './harness.js'

let app: ElectronApplication
let window: Page
let stateDir: string

test.beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'jm-e2e-'))
  // UTC, so a sprint date reads the same on every machine.
  ;({ app, window } = await launch(stateDir, { TZ: 'Etc/UTC' }))
})

test.afterEach(async () => {
  await app.close()
  await rm(stateDir, { recursive: true, force: true })
})

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: RegExp) => tree().getByRole('treeitem', { name })
const sidebar = () => window.getByRole('navigation', { name: 'Main' })
const entry = (name: 'Current' | 'Upcoming') =>
  sidebar()
    .getByRole('region', { name: 'Sprints' })
    .getByRole('button', { name: new RegExp('^' + name) })
const issuesLink = () => sidebar().getByRole('link', { name: /^Issues/ })
const sprintPage = () => window.getByRole('region', { name: 'Sprint page' })
const issuePage = () => window.getByRole('region', { name: 'Issue page' })
const panel = () => sprintPage().getByRole('complementary', { name: 'Sprint details' })
const tab = (name: string) => panel().getByRole('tab', { name })
const rows = () => panel().getByRole('tabpanel').getByRole('listitem')

/** PSAPAC-13 starts in the active sprint. These six join it, so it holds seven. */
const MEMBERS = [
  'PSAPAC-1',
  'PSAPAC-2',
  'PSAPAC-4',
  'PSAPAC-11',
  'PSAPAC-13',
  'PSAPAC-14',
  'PSAPAC-22',
]

async function open() {
  await joinSprint(app, MEMBERS, 5)
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
}

/** One count of the progress block, such as `Started` giving "3 43%". */
const count = (name: string) =>
  panel().getByText(name, { exact: true }).locator('xpath=following-sibling::dd').innerText()

test('draws a Sprint page row summary in the key colour', async () => {
  await open()
  await entry('Current').click()
  const row = sprintPage().locator('[data-issue-key=PSAPAC-2]')
  const colour = (field: Locator) => field.evaluate((el) => getComputedStyle(el).color)
  const key = await colour(row.getByText('PSAPAC-2', { exact: true }))
  expect(await colour(row.getByText('Review the data model'))).toBe(key)
  // Pinned to the token, so the test fails if the key and summary both turn ink.
  const muted = await window.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--muted)'
    document.body.append(probe)
    const painted = getComputedStyle(probe).color
    probe.remove()
    return painted
  })
  expect(key).toBe(muted)
})

test('opens the active sprint from the sidebar with counts that equal its issues', async () => {
  await open()
  await expect(entry('Current')).toContainText('Sprint 5')
  await expect(entry('Upcoming')).toContainText('Sprint 6')
  await entry('Current').click()

  await expect(sprintPage()).toBeVisible()
  await expect(sprintPage()).toBeFocused()
  await expect(sprintPage().getByRole('heading', { name: 'Sprint 5', level: 1 })).toBeVisible()
  await expect(sprintPage().getByRole('status')).toHaveText('7 issues')

  // The list holds the seven issues the fake puts in the sprint, and no other.
  const keys = await sprintPage()
    .getByRole('button', { name: /^PSAPAC-\d+ / })
    .evaluateAll((buttons) =>
      buttons.map((b) => /^PSAPAC-\d+/.exec(b.getAttribute('aria-label') ?? '')?.[0] ?? ''),
    )
  expect(keys.sort()).toEqual([...MEMBERS].sort())
  // Grouped by status: 2 To Do, 3 In Progress and 2 Done.
  await expect(
    sprintPage().getByRole('region', { name: 'To Do' }).getByRole('listitem'),
  ).toHaveCount(2)
  await expect(
    sprintPage().getByRole('region', { name: 'In Progress' }).getByRole('listitem'),
  ).toHaveCount(3)
  await expect(
    sprintPage().getByRole('region', { name: 'Done' }).getByRole('listitem'),
  ).toHaveCount(2)

  // The panel counts the same seven: Completed means the Done status category.
  expect(await count('Scope')).toBe('7')
  expect(await count('Started')).toBe('3 43%')
  expect(await count('Completed')).toBe('2 29%')
  const bar = panel().getByRole('progressbar', { name: 'Sprint progress' })
  await expect(bar).toHaveAttribute('aria-valuenow', '29')
  await expect(bar).toHaveAttribute('aria-valuetext', '29% completed, 43% started')

  await expect(panel().getByText('1 Oct 2026')).toBeVisible()
  await expect(panel().getByText('14 Oct 2026')).toBeVisible()
  await expect(panel().getByText('Ship the onboarding flow')).toBeVisible()
  await expect(panel().getByText('Active', { exact: true })).toBeVisible()
})

test('the tabs show N% of M for assignees, labels, priority, Customer and Engagement', async () => {
  await open()
  await entry('Current').click()
  await expect(tab('Assignees')).toHaveAttribute('aria-selected', 'true')
  // Largest group first, and the issues with no assignee last.
  await expect(rows()).toHaveText([
    /Test User\s*0% of 2/,
    /Other User\s*0% of 1/,
    /Unassigned\s*50% of 4/,
  ])

  await tab('Labels').click()
  await expect(rows()).toHaveText([/docs\s*0% of 1/, /No label\s*33% of 6/])
  await tab('Priority').click()
  await expect(rows()).toHaveText([/Medium\s*29% of 7/])
  await tab('Customer').click()
  await expect(rows()).toHaveText([/Acme\s*17% of 6/, /Beta Ltd\s*100% of 1/])
  await tab('Engagement').click()
  await expect(rows()).toHaveText([/North\s*29% of 7/])
})

test('arrow keys move between the tabs and select as they go', async () => {
  await open()
  await entry('Current').click()
  await tab('Assignees').focus()
  await window.keyboard.press('ArrowRight')
  await expect(tab('Labels')).toBeFocused()
  await expect(tab('Labels')).toHaveAttribute('aria-selected', 'true')
  await window.keyboard.press('End')
  await expect(tab('Engagement')).toBeFocused()
  await window.keyboard.press('ArrowRight')
  await expect(tab('Assignees')).toBeFocused()
  await window.keyboard.press('ArrowLeft')
  await expect(tab('Engagement')).toHaveAttribute('aria-selected', 'true')
  // Only the selected tab is in the Tab order.
  await expect(tab('Labels')).toHaveAttribute('tabindex', '-1')
})

test('opens the sprint from the link beside the Sprint value on an issue page', async () => {
  await open()
  await item(/PSAPAC-13,/).click()
  await window.keyboard.press('Enter')
  await expect(issuePage()).toBeVisible()
  const props = issuePage().getByRole('complementary', { name: 'Properties' })
  await expect(props.getByRole('button', { name: 'Sprint: Sprint 5' })).toBeVisible()

  await props.getByRole('button', { name: 'Open sprint Sprint 5' }).click()
  await expect(issuePage()).toHaveCount(0)
  await expect(sprintPage().getByRole('heading', { name: 'Sprint 5', level: 1 })).toBeVisible()
  await expect(sprintPage().getByRole('status')).toHaveText('7 issues')
  await expect(entry('Current')).toHaveAttribute('aria-current', 'page')
})

test('only an issue that is in a sprint has the link to open it', async () => {
  await open()
  await item(/PSAPAC-3,/).click()
  await window.keyboard.press('Enter')
  const props = issuePage().getByRole('complementary', { name: 'Properties' })
  await expect(props.getByRole('button', { name: 'Sprint: Backlog' })).toBeVisible()
  await expect(props.getByRole('button', { name: /^Open sprint/ })).toHaveCount(0)

  // The same page for an issue in the sprint has it.
  await window.keyboard.press('Escape')
  await expect(issuePage()).toHaveCount(0)
  await item(/PSAPAC-13,/).click()
  await window.keyboard.press('Enter')
  await expect(props.getByRole('button', { name: 'Sprint: Sprint 5' })).toBeVisible()
  await expect(props.getByRole('button', { name: 'Open sprint Sprint 5' })).toBeVisible()
})

test('shows an empty sprint with zero counts and nothing to break down', async () => {
  await open()
  await entry('Upcoming').click()
  await expect(sprintPage().getByRole('heading', { name: 'Sprint 6', level: 1 })).toBeVisible()
  await expect(sprintPage().getByRole('status')).toHaveText('0 issues')
  await expect(sprintPage().getByText('No issues in this sprint.')).toBeVisible()
  expect(await count('Scope')).toBe('0')
  expect(await count('Started')).toBe('0 0%')
  expect(await count('Completed')).toBe('0 0%')
  await expect(panel().getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  await expect(panel().getByText('No goal set')).toBeVisible()
  await expect(panel().getByText('Future', { exact: true })).toBeVisible()
  for (const name of ['Assignees', 'Labels', 'Priority', 'Customer', 'Engagement']) {
    await tab(name).click()
    await expect(panel().getByText('Nothing to show.')).toBeVisible()
  }
})

/** What the sidebar's lit item looks like to the eye. */
const lit = (target: Locator) =>
  target.evaluate((el) => {
    const s = getComputedStyle(el)
    return {
      fill: s.backgroundColor,
      weight: s.fontWeight,
      shadow: s.boxShadow,
      left: s.borderLeftWidth,
      outline: s.outlineStyle,
    }
  })

test('lights one sidebar item, by fill and weight, and gives the highlight back on leaving', async () => {
  await open()
  await expect(issuesLink()).toHaveAttribute('aria-current', 'page')
  const issuesLit = await lit(issuesLink())

  await entry('Current').click()
  await expect(entry('Current')).toHaveAttribute('aria-current', 'page')
  await expect(issuesLink()).not.toHaveAttribute('aria-current')
  await expect(issuesLink()).not.toHaveClass(/is-current/)
  await expect(entry('Upcoming')).not.toHaveAttribute('aria-current')
  expect(await sidebar().locator('[aria-current]').count()).toBe(1)
  // The same fill and weight as Issues has, with no edge, bar or ring.
  // A button eases its fill in over 120 ms, so the fill is polled.
  await expect
    .poll(() => lit(entry('Current')))
    .toMatchObject({ fill: issuesLit.fill, weight: '500', shadow: 'none', left: '0px' })

  await entry('Upcoming').click()
  await expect(entry('Upcoming')).toHaveAttribute('aria-current', 'page')
  await expect(entry('Current')).not.toHaveAttribute('aria-current')
  expect(await sidebar().locator('[aria-current]').count()).toBe(1)

  await window.keyboard.press('Escape')
  await expect(sprintPage()).toHaveCount(0)
  await expect(tree()).toBeFocused()
  await expect(issuesLink()).toHaveAttribute('aria-current', 'page')
  await expect(entry('Upcoming')).not.toHaveAttribute('aria-current')
})

test('a lit saved view gives the highlight to the open sprint and takes it back on leaving', async () => {
  await open()
  const view = window
    .getByRole('list', { name: 'Saved views' })
    .getByRole('button', { name: 'My issues', exact: true })
  await view.click()
  await expect(view).toHaveAttribute('aria-current', 'true')

  await entry('Current').click()
  await expect(entry('Current')).toHaveAttribute('aria-current', 'page')
  await expect(view).not.toHaveAttribute('aria-current')
  await expect(issuesLink()).not.toHaveAttribute('aria-current')
  expect(await sidebar().locator('[aria-current]').count()).toBe(1)

  await window.keyboard.press('Escape')
  await expect(view).toHaveAttribute('aria-current', 'true')
  await expect(entry('Current')).not.toHaveAttribute('aria-current')
  expect(await sidebar().locator('[aria-current]').count()).toBe(1)
})

test('Esc, Back and the Issues link leave the sprint page for the Tree', async () => {
  await open()
  await entry('Current').click()
  await expect(sprintPage()).toBeFocused()
  await window.keyboard.press('Escape')
  await expect(sprintPage()).toHaveCount(0)
  await expect(tree()).toBeFocused()

  await entry('Current').click()
  await sprintPage().getByRole('button', { name: 'Back to issues' }).click()
  await expect(sprintPage()).toHaveCount(0)
  await expect(tree()).toBeFocused()

  await entry('Current').click()
  await issuesLink().click()
  await expect(sprintPage()).toHaveCount(0)
  await expect(tree()).toBeFocused()

  // Esc from the sidebar, where focus sits after a click on it, leaves too.
  await entry('Current').click()
  await entry('Upcoming').focus()
  await window.keyboard.press('Escape')
  await expect(sprintPage()).toHaveCount(0)
})

test('opens an issue from the sprint, and Back returns to the sprint', async () => {
  await open()
  await entry('Current').click()
  await sprintPage()
    .getByRole('button', { name: /^PSAPAC-13 / })
    .click()
  await expect(issuePage().getByRole('heading', { name: 'Book the kickoff' })).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(issuePage()).toHaveCount(0)
  await expect(sprintPage()).toBeVisible()
  await expect(sprintPage()).toBeFocused()
  await window.keyboard.press('Escape')
  await expect(sprintPage()).toHaveCount(0)
  await expect(tree()).toBeFocused()
})

test('applying a saved view leaves the sprint page, and the view takes the highlight', async () => {
  await open()
  await entry('Current').click()
  await window
    .getByRole('list', { name: 'Saved views' })
    .getByRole('button', { name: 'My issues', exact: true })
    .click()
  await expect(sprintPage()).toHaveCount(0)
  await expect(tree()).toBeFocused()
  await expect(
    window
      .getByRole('list', { name: 'Saved views' })
      .getByRole('button', { name: 'My issues', exact: true }),
  ).toHaveAttribute('aria-current', 'true')
  await expect(entry('Current')).not.toHaveAttribute('aria-current')
})

test('holds its layout with a wide font: no clipped row, tab or count', async () => {
  await open()
  await entry('Current').click()
  await expect(sprintPage().getByRole('status')).toHaveText('7 issues')
  await window.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important }' })
  for (const name of ['Assignees', 'Labels', 'Priority', 'Customer', 'Engagement']) {
    await tab(name).click()
    const clipped = await window.evaluate(() => {
      const bad: string[] = []
      const aside = document.querySelector('[aria-label="Sprint details"]')
      if (aside === null) return ['no panel']
      if (aside.scrollWidth > aside.clientWidth) bad.push('panel scrolls sideways')
      const frame = aside.getBoundingClientRect()
      for (const el of aside.querySelectorAll('[role="tab"], [role="tabpanel"] li, dd')) {
        const box = el.getBoundingClientRect()
        if (box.right > frame.right + 0.5 || box.left < frame.left - 0.5)
          bad.push(`${el.textContent} sits outside the panel`)
        // A share and a count stay whole: only a name may truncate.
        if (el.matches('li') && el.scrollWidth > el.clientWidth + 0.5)
          bad.push(`${el.textContent} is clipped`)
      }
      return bad
    })
    expect(clipped, name).toEqual([])
  }
  // The sidebar entries keep both words on one line in the wide font.
  for (const name of ['Current', 'Upcoming'] as const) {
    const heights = await entry(name).evaluate((el) =>
      [...el.children].map((child) => child.getBoundingClientRect().height),
    )
    expect(Math.max(...heights), name).toBeLessThanOrEqual(20)
  }
})

/** Waits for the write to arrive at the fake, lets it answer, and waits for the answer to land. */
async function settle(expected: number) {
  await expect.poll(async () => (await counts(app)).edits).toBe(expected)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(expected)
}

test('counts an edit made on an issue opened from the sprint once the page is back', async () => {
  await open()
  await entry('Current').click()
  expect(await count('Completed')).toBe('2 29%')
  expect(await count('Started')).toBe('3 43%')

  await sprintPage()
    .getByRole('button', { name: /^PSAPAC-4 / })
    .click()
  await issuePage()
    .getByRole('button', { name: /^Status:/ })
    .click()
  await window.getByRole('option', { name: 'Done' }).click()
  await settle(1)
  await window.keyboard.press('Escape')
  await expect(issuePage()).toHaveCount(0)

  // PSAPAC-4 moved from In Progress to Done, so the page shows it there and counts it.
  await expect(
    sprintPage().getByRole('region', { name: 'Done' }).getByRole('listitem'),
  ).toHaveCount(3)
  await expect(
    sprintPage().getByRole('region', { name: 'In Progress' }).getByRole('listitem'),
  ).toHaveCount(2)
  await expect.poll(() => count('Completed')).toBe('3 43%')
  expect(await count('Started')).toBe('2 29%')
  expect(await count('Scope')).toBe('7')
  await expect(panel().getByRole('progressbar')).toHaveAttribute('aria-valuenow', '43')
})

test('drops an issue moved out of the sprint from its rows and its Scope', async () => {
  await open()
  await entry('Current').click()
  await sprintPage()
    .getByRole('button', { name: /^PSAPAC-13 / })
    .click()
  await issuePage().getByRole('button', { name: 'Sprint: Sprint 5' }).click()
  await window.getByRole('option', { name: 'Backlog' }).click()
  await settle(1)
  await window.keyboard.press('Escape')
  await expect(issuePage()).toHaveCount(0)

  await expect(sprintPage().getByRole('status')).toHaveText('6 issues')
  await expect(sprintPage().getByRole('button', { name: /^PSAPAC-13 / })).toHaveCount(0)
  await expect.poll(() => count('Scope')).toBe('6')
  expect(await count('Started')).toBe('2 33%')
})

test('keeps focus out of the sprint page while an issue page is open over it', async () => {
  await open()
  await entry('Current').click()
  await sprintPage()
    .getByRole('button', { name: /^PSAPAC-13 / })
    .click()
  await expect(issuePage()).toBeFocused()
  // The page is the sprint page's child in the layout only: nothing in it may take focus.
  const inside = () =>
    window.evaluate(() => document.activeElement?.closest('[aria-label="Sprint page"]') !== null)
  // The sprint page comes before the issue page in the layout, so Shift+Tab walks back into it.
  for (let i = 0; i < 12; i++) {
    await window.keyboard.press('Shift+Tab')
    expect(await inside(), `Shift+Tab ${String(i + 1)}`).toBe(false)
  }
  await issuePage().focus()
  for (let i = 0; i < 40; i++) {
    await window.keyboard.press('Tab')
    expect(await inside(), `Tab ${String(i + 1)}`).toBe(false)
  }
  await expect(sprintPage().getByRole('button', { name: 'Back to issues' })).not.toBeFocused()

  // Back on the sprint page, its own controls take focus again.
  await window.keyboard.press('Escape')
  await expect(issuePage()).toHaveCount(0)
  await expect(sprintPage()).toBeFocused()
  await window.keyboard.press('Tab')
  expect(await inside()).toBe(true)
})

test('the palette offers no action for the Tree row a Sprint page hides', async () => {
  await open()
  await item(/PSAPAC-2,/).click()
  await window.keyboard.press('Escape')
  await expect(window.getByRole('complementary', { name: 'Peek' })).toHaveCount(0)
  await entry('Current').click()
  await expect(sprintPage()).toBeFocused()

  await window.keyboard.press('Meta+k')
  const palette = window.getByRole('dialog', { name: 'Search issues' })
  await expect(palette).toBeVisible()
  await expect(palette.getByRole('group', { name: 'Actions' })).toHaveCount(0)
  await expect(palette.getByRole('option', { name: /Assign to me/ })).toHaveCount(0)
  await window.keyboard.press('Escape')
  await expect(palette).toHaveCount(0)
  // Focus returns to the sprint page, not to the inert Tree.
  await expect(sprintPage()).toBeFocused()
})
