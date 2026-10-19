/// <reference lib="dom" />
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'

import {
  addWorklog,
  cancelNextDownload,
  counts,
  failUpload,
  holdReads,
  launch,
  logIn,
  notices,
  peekRow,
  refuseNextEdit,
  releaseEdit,
  releaseReads,
  releaseUpload,
  removeComment,
  setComment,
} from './harness.js'

let app: ElectronApplication
let window: Page
let stateDir: string

test.beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'jm-e2e-'))
  ;({ app, window } = await launch(stateDir))
})

test.afterEach(async () => {
  // An image embedded in the description leaves a draft, which would raise the quit prompt.
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
const issuePage = () => window.getByRole('region', { name: 'Issue page' })
const props = () => issuePage().getByRole('complementary', { name: 'Properties' })
const heading = (name: string) => issuePage().getByRole('heading', { name })
const section = (name: string) => issuePage().getByRole('region', { name })
const MOD = 'ControlOrMeta'

async function openPage(row: RegExp, title: string) {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
  await peekRow(item(row))
  await window.keyboard.press('Enter')
  await expect(heading(title)).toBeVisible()
  await expect(section('Activity').getByText('Loading comments')).toHaveCount(0)
  await expect(section('Attachments').getByText('Loading attachments')).toHaveCount(0)
}

/** PSAPAC-1 holds two comments, two links and two attachments. */
const openStory = () => openPage(/PSAPAC-1,/, 'Kick off the engagement')
/** PSAPAC-4 has a 2h estimate and nothing else. */
const openEstimated = () => openPage(/PSAPAC-4,/, 'Migrate the dashboards')
/** PSAPAC-2 holds two worklogs, one by the signed-in user. */
const openLogged = () => openPage(/PSAPAC-2,/, 'Review the data model')

const writes = async () => (await counts(app)).edits
const lastBody = async () => (await counts(app)).editBodies.at(-1)

/** Waits for the write to arrive, then lets the fake Jira answer it. */
async function settle(expected: number) {
  await expect.poll(writes).toBe(expected)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(expected)
}

/** For a write the fake refuses: it arrives and answers, but nothing is applied. */
async function settleRefused(expected: number) {
  await expect.poll(writes).toBe(expected)
  await releaseEdit(app)
}

/** A document of one paragraph, as another user's edit in Jira would store it. */
const adf = (text: string) => ({
  version: 1,
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const TEXT_FILE = { name: 'notes.txt', type: 'text/plain', data: btoa('hello') }

/** Fires a drag event carrying one file at the element, as a file dragged in from the desktop would. */
async function dragFile(
  target: Locator,
  type: 'dragenter' | 'dragleave' | 'drop',
  file: { name: string; type: string; data: string } = TEXT_FILE,
) {
  await target.evaluate(
    (element, [kind, name, mime, data]) => {
      const bytes = Uint8Array.from(atob(data ?? ''), (c) => c.charCodeAt(0))
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], name ?? 'a', { type: mime ?? '' }))
      element.dispatchEvent(
        new DragEvent(kind ?? 'drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
      )
    },
    [type, file.name, file.type, file.data],
  )
}

const attachZone = () => issuePage().locator('[data-drop-zone="Attach file to issue"]')
const describeZone = () => issuePage().locator('[data-drop-zone="Add images into description"]')
const uploads = async () => (await counts(app)).uploads

test.describe('lists', () => {
  test('shows the comments, links and attachments of the issue', async () => {
    await openStory()

    const activity = section('Activity')
    await expect(activity.getByText('My first comment')).toBeVisible()
    await expect(activity.getByText('A comment by someone else')).toBeVisible()
    await expect(activity.getByText('Test User', { exact: true })).toBeVisible()
    await expect(activity.getByText('Other User', { exact: true })).toBeVisible()

    const links = section('Links')
    await expect(links.getByRole('heading', { name: 'blocks' })).toBeVisible()
    await expect(links.getByRole('button', { name: 'PSAPAC-2', exact: true })).toBeVisible()
    await expect(links.getByRole('heading', { name: 'relates to' })).toBeVisible()
    await expect(links.getByRole('button', { name: 'PSAPAC-3', exact: true })).toBeVisible()

    const files = section('Attachments')
    await expect(files.getByText('diagram.png')).toBeVisible()
    await expect(files.getByText('report.xlsx')).toBeVisible()
    await expect(files.getByText('10 B')).toBeVisible()
  })

  test('shows the worklogs of the issue and their total, and none on an Epic', async () => {
    await openLogged()
    const logs = section('Worklogs')
    await expect(logs.getByText('Test User')).toBeVisible()
    await expect(logs.getByText('Other User')).toBeVisible()
    await expect(logs.getByText('Set up the model')).toBeVisible()
    await expect(logs).toContainText('Logged 1h 30m')

    await issuePage().getByRole('button', { name: 'Back to issues' }).click()
    await peekRow(item(/PSAPAC-10,/))
    await window.keyboard.press('Enter')
    await expect(heading('Customer onboarding')).toBeVisible()
    await expect(section('Worklogs')).toHaveCount(0)
    await expect(section('Activity')).toBeVisible()
  })
})

test.describe('comments', () => {
  const composer = () => section('Activity').getByRole('textbox', { name: 'New comment' })
  const post = () => section('Activity').getByRole('button', { name: 'Comment', exact: true })

  test('adds a comment with Cmd+Enter, and the box clears', async () => {
    await openStory()
    await expect(post()).toBeDisabled()
    await composer().click()
    await window.keyboard.type('Hello there')
    await expect(post()).toBeEnabled()
    await window.keyboard.press(`${MOD}+Enter`)

    // Jira's answer gives the comment its id, so nothing shows until it comes.
    await expect.poll(writes).toBe(1)
    const sent = (await lastBody()) as { comment: string; body: { content: unknown[] } }
    expect(sent.comment).toBe('add')
    expect(JSON.stringify(sent.body)).toContain('Hello there')
    await expect(section('Activity').getByText('Posting')).toBeVisible()
    await expect(section('Activity').getByText('Hello there')).toHaveCount(1)
    await releaseEdit(app)

    await expect(section('Activity').getByText('Posting')).toHaveCount(0)
    await expect(section('Activity').getByText('Hello there')).toHaveCount(1)
    await expect(composer()).toHaveText('')
    await expect(post()).toBeDisabled()
    await expect(composer()).toBeFocused()
  })

  test('does not post twice when Cmd+Enter is pressed twice', async () => {
    await openStory()
    await composer().click()
    await window.keyboard.type('Once')
    await window.keyboard.press(`${MOD}+Enter`)
    await window.keyboard.press(`${MOD}+Enter`)
    await expect.poll(writes).toBe(1)
    await releaseEdit(app)
    await expect(section('Activity').getByText('Once')).toHaveCount(1)
    expect(await writes()).toBe(1)
  })

  test('keeps the text and says why when Jira refuses a comment', async () => {
    await openStory()
    await composer().click()
    await window.keyboard.type('Refused words')
    await refuseNextEdit(app)
    await window.keyboard.press(`${MOD}+Enter`)
    await settleRefused(1)
    await expect(section('Activity').getByRole('alert')).toContainText(
      'Could not post the comment.',
    )
    await expect(composer()).toContainText('Refused words')
  })

  test("offers Edit and Delete on the signed-in user's own comment only", async () => {
    await openStory()
    await expect(section('Activity').getByRole('button', { name: 'Edit comment' })).toHaveCount(1)
    await expect(section('Activity').getByRole('button', { name: 'Delete comment' })).toHaveCount(1)
  })

  test('edits a comment, and shows it as edited once Jira answers', async () => {
    await openStory()
    await section('Activity').getByRole('button', { name: 'Edit comment' }).click()
    const editor = section('Activity').getByRole('textbox', { name: 'Comment by Test User' })
    await expect(editor).toBeFocused()
    await window.keyboard.press('End')
    await window.keyboard.type(' again')
    await window.keyboard.press(`${MOD}+Enter`)

    await expect.poll(writes).toBe(1)
    const sent = (await lastBody()) as { comment: string; id: number; body: unknown }
    expect(sent).toMatchObject({ comment: 'edit', id: 7900 })
    expect(JSON.stringify(sent.body)).toContain('My first comment again')
    await expect(section('Activity').getByText('Saving')).toBeVisible()
    await releaseEdit(app)

    await expect(section('Activity').getByText('My first comment again')).toBeVisible()
    await expect(section('Activity').getByText('(edited)')).toBeVisible()
    await expect(section('Activity').getByRole('button', { name: 'Edit comment' })).toBeVisible()
  })

  test('keeps the text in the editor and says why when Jira refuses an edit', async () => {
    await openStory()
    await section('Activity').getByRole('button', { name: 'Edit comment' }).click()
    await window.keyboard.press('End')
    await window.keyboard.type(' lost?')
    await refuseNextEdit(app)
    await window.keyboard.press(`${MOD}+Enter`)
    await settleRefused(1)

    await expect(section('Activity').getByRole('alert')).toContainText(
      'Could not save the comment, so Jira still holds the old one.',
    )
    const editor = section('Activity').getByRole('textbox', { name: 'Comment by Test User' })
    await expect(editor).toContainText('My first comment lost?')
  })

  test('asks before discarding an edit, and Esc keeps editing', async () => {
    await openStory()
    const editor = section('Activity').getByRole('textbox', { name: 'Comment by Test User' })
    await section('Activity').getByRole('button', { name: 'Edit comment' }).click()
    await expect(editor).toBeFocused()
    await window.keyboard.type('!')
    await expect(editor).toContainText('My first comment!')
    await window.keyboard.press('Escape')
    const keep = window.getByRole('button', { name: 'Keep editing' })
    await expect(window.getByRole('alertdialog')).toBeVisible()
    await expect(keep).toBeFocused()
    await window.keyboard.press('Escape')
    await expect(window.getByRole('alertdialog')).toHaveCount(0)
    await expect(editor).toBeFocused()
    await window.keyboard.press('Escape')
    await expect(keep).toBeFocused()
    await window.getByRole('button', { name: 'Discard', exact: true }).click()
    await expect(section('Activity').getByText('My first comment!')).toHaveCount(0)
    await expect(section('Activity').getByText('My first comment')).toBeVisible()
    expect(await writes()).toBe(0)
  })

  const blocksUnload = () => window.evaluate(() => typeof globalThis.onbeforeunload === 'function')

  test('keeps an unsaved comment edit when the page is left, and holds a quit', async () => {
    await openStory()
    await section('Activity').getByRole('button', { name: 'Edit comment' }).click()
    const editor = section('Activity').getByRole('textbox', { name: 'Comment by Test User' })
    await expect(editor).toBeFocused()
    await window.keyboard.press('End')
    await window.keyboard.type(' and more')
    await expect(editor).toContainText('My first comment and more')
    // The key line is plain text, so the click moves focus to the page without editing the summary.
    await issuePage().getByRole('heading', { level: 1 }).click()
    await window.keyboard.press('Escape')
    await expect(issuePage()).toHaveCount(0)
    await expect.poll(blocksUnload).toBe(true)

    await peekRow(item(/PSAPAC-1,/))
    await window.keyboard.press('Enter')
    await expect(heading('Kick off the engagement')).toBeVisible()
    await expect(editor).toContainText('My first comment and more')
    await expect(section('Activity').getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(await writes()).toBe(0)

    await window.keyboard.press('Escape')
    await expect(window.getByRole('alertdialog')).toBeVisible()
    await window.getByRole('button', { name: 'Discard', exact: true }).click()
    await expect.poll(blocksUnload).toBe(false)
  })

  test('keeps the text of the comment box when the page is left', async () => {
    await openStory()
    await section('Activity').getByRole('textbox', { name: 'New comment' }).click()
    await window.keyboard.type('Half written')
    await issuePage().getByRole('button', { name: 'Back to issues' }).click()
    await expect(issuePage()).toHaveCount(0)
    await peekRow(item(/PSAPAC-1,/))
    await window.keyboard.press('Enter')
    await expect(heading('Kick off the engagement')).toBeVisible()
    await expect(section('Activity').getByRole('textbox', { name: 'New comment' })).toContainText(
      'Half written',
    )
    await expect(
      section('Activity').getByRole('button', { name: 'Comment', exact: true }),
    ).toBeEnabled()
  })

  /** Edits the signed-in user's comment, types ` again`, leaves the page, and has Jira change or lose the comment. */
  async function leaveWithDraft() {
    await openStory()
    await section('Activity').getByRole('button', { name: 'Edit comment' }).click()
    await expect(
      section('Activity').getByRole('textbox', { name: 'Comment by Test User' }),
    ).toBeFocused()
    await window.keyboard.press('End')
    await window.keyboard.type(' again')
    await issuePage().getByRole('heading', { level: 1 }).click()
    await window.keyboard.press('Escape')
    await expect(issuePage()).toHaveCount(0)
    await expect.poll(blocksUnload).toBe(true)
  }

  async function reopenStory() {
    await peekRow(item(/PSAPAC-1,/))
    await window.keyboard.press('Enter')
    await expect(heading('Kick off the engagement')).toBeVisible()
    await expect(
      section('Activity').getByRole('textbox', { name: 'Comment by Test User' }),
    ).toContainText('My first comment again')
  }

  test('asks before a restored draft saves over a comment edited in Jira, and saves it on request', async () => {
    await leaveWithDraft()
    await setComment(app, 'PSAPAC-1', 7900, adf('Edited by someone else'))
    await reopenStory()
    await section('Activity').getByRole('button', { name: 'Save' }).click()

    await expect(section('Activity').getByRole('alert')).toContainText(
      'This comment changed in Jira while you edited.',
    )
    expect(await writes()).toBe(0)
    await section('Activity').getByRole('button', { name: 'Save mine anyway' }).click()
    await expect.poll(writes).toBe(1)
    expect(JSON.stringify(await lastBody())).toContain('My first comment again')
    await releaseEdit(app)
    await expect(section('Activity').getByText('My first comment again')).toBeVisible()
    await expect(section('Activity').getByRole('alert')).toHaveCount(0)
    await expect.poll(blocksUnload).toBe(false)
  })

  test("shows Jira's comment and drops the draft when the user discards theirs", async () => {
    await leaveWithDraft()
    await setComment(app, 'PSAPAC-1', 7900, adf('Edited by someone else'))
    await reopenStory()
    await section('Activity').getByRole('button', { name: 'Save' }).click()
    await section('Activity').getByRole('button', { name: 'Discard mine' }).click()

    await expect(section('Activity').getByText('Edited by someone else')).toBeVisible()
    await expect(section('Activity').getByText('My first comment again')).toHaveCount(0)
    expect(await writes()).toBe(0)
    await expect.poll(blocksUnload).toBe(false)
  })

  test('saves a restored draft with no prompt when the comment is unchanged in Jira', async () => {
    await leaveWithDraft()
    await reopenStory()
    await section('Activity').getByRole('button', { name: 'Save' }).click()
    await expect.poll(writes).toBe(1)
    await releaseEdit(app)
    await expect(section('Activity').getByRole('alert')).toHaveCount(0)
    await expect(section('Activity').getByText('My first comment again')).toBeVisible()
  })

  test('stops counting the draft of a comment deleted in Jira', async () => {
    await leaveWithDraft()
    await removeComment(app, 'PSAPAC-1', 7900)
    await peekRow(item(/PSAPAC-1,/))
    await window.keyboard.press('Enter')
    await expect(heading('Kick off the engagement')).toBeVisible()

    await expect(section('Activity').getByText('My first comment')).toHaveCount(0)
    await expect.poll(blocksUnload).toBe(false)
  })

  test('moves the typed text to the comment box when the comment was deleted in Jira before the save', async () => {
    await openStory()
    await section('Activity').getByRole('button', { name: 'Edit comment' }).click()
    const editor = section('Activity').getByRole('textbox', { name: 'Comment by Test User' })
    await expect(editor).toBeFocused()
    await window.keyboard.press('End')
    await window.keyboard.type(' again')
    await removeComment(app, 'PSAPAC-1', 7900)
    await section('Activity').getByRole('button', { name: 'Save' }).click()

    await expect(section('Activity').getByRole('alert')).toContainText(
      'The comment was deleted in Jira, so it cannot be saved. Your text is in the new comment box.',
    )
    const box = section('Activity').getByRole('textbox', { name: 'New comment' })
    await expect(box).toContainText('My first comment again')
    expect(await writes()).toBe(0)

    // The next window focus reads the comments again: the row goes, and the text stays in the box.
    await app.evaluate(({ BrowserWindow }) => {
      const [first] = BrowserWindow.getAllWindows()
      first?.emit('blur')
      first?.emit('focus')
    })
    await expect(section('Activity').getByText('My first comment', { exact: true })).toHaveCount(0)
    await expect(editor).toHaveCount(0)
    await expect(box).toContainText('My first comment again')
    await expect(
      section('Activity').getByRole('button', { name: 'Comment', exact: true }),
    ).toBeEnabled()
    await expect.poll(blocksUnload).toBe(true)
  })

  test('keeps the text in the row, and says so, when the comment box holds text already', async () => {
    await openStory()
    await section('Activity').getByRole('textbox', { name: 'New comment' }).click()
    await window.keyboard.type('Already here')
    await section('Activity').getByRole('button', { name: 'Edit comment' }).click()
    const editor = section('Activity').getByRole('textbox', { name: 'Comment by Test User' })
    await expect(editor).toBeFocused()
    await window.keyboard.press('End')
    await window.keyboard.type(' again')
    await removeComment(app, 'PSAPAC-1', 7900)
    await section('Activity').getByRole('button', { name: 'Save' }).click()

    await expect(section('Activity').getByRole('alert')).toContainText(
      'the comment box already holds text',
    )
    await expect(editor).toContainText('My first comment again')
    await expect(section('Activity').getByRole('textbox', { name: 'New comment' })).toContainText(
      'Already here',
    )
  })

  test('deletes a comment at once and sends the delete after the confirmation', async () => {
    await openStory()
    await section('Activity').getByRole('button', { name: 'Delete comment' }).click()
    await expect(section('Activity').getByText('Delete this comment?')).toBeVisible()
    expect(await writes()).toBe(0)
    await section('Activity').getByRole('button', { name: 'Delete', exact: true }).click()

    await expect(section('Activity').getByText('My first comment')).toHaveCount(0)
    await expect.poll(writes).toBe(1)
    expect(await lastBody()).toMatchObject({ comment: 'delete', id: 7900 })
    await releaseEdit(app)
    await expect.poll(async () => (await counts(app)).applied).toBe(1)
    await expect(section('Activity').getByText('My first comment')).toHaveCount(0)
    await expect(section('Activity').getByText('A comment by someone else')).toBeVisible()
  })

  test('puts a comment back, and says why, when Jira refuses the delete', async () => {
    await openStory()
    await section('Activity').getByRole('button', { name: 'Delete comment' }).click()
    await section('Activity').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(section('Activity').getByText('My first comment')).toHaveCount(0)
    await refuseNextEdit(app)
    // The list read that follows the write waits, so only the rollback can put the row back.
    await holdReads(app)
    await settleRefused(1)

    await expect(section('Activity').getByText('My first comment')).toBeVisible()
    await expect(window.getByRole('alert')).toContainText('Could not delete the comment')
    await releaseReads(app)
    await expect(section('Activity').getByText('My first comment')).toBeVisible()
  })
})

test.describe('worklogs', () => {
  const estimate = () => props().getByLabel('Time left')
  const form = (name: string) => section('Worklogs').getByRole('form', { name })

  async function logWork(time: string, note: string) {
    await section('Worklogs').getByRole('button', { name: 'Add worklog' }).click()
    await form('Add worklog').getByLabel('Time spent').fill(time)
    await form('Add worklog').getByLabel('Comment').fill(note)
    await form('Add worklog').getByRole('button', { name: 'Log work' }).click()
  }

  test('logs work with adjustEstimate=auto, and Time remaining falls once Jira answers', async () => {
    await openEstimated()
    await expect(estimate()).toHaveValue('2h')
    await logWork('30m', 'Wired it up')

    await expect.poll(writes).toBe(1)
    expect(await lastBody()).toMatchObject({
      worklog: 'add',
      key: 'PSAPAC-4',
      adjustEstimate: 'auto',
      timeSpent: '30m',
    })
    await expect(form('Add worklog').getByRole('button', { name: 'Saving' })).toBeDisabled()
    await releaseEdit(app)

    await expect(form('Add worklog')).toHaveCount(0)
    await expect(section('Worklogs').getByText('Wired it up')).toBeVisible()
    await expect(section('Worklogs')).toContainText('Logged 30m')
    await expect(props()).toContainText('Remaining estimate, read-only: 1h 30m')
    await expect(estimate()).toHaveValue('1h 30m')
  })

  test('refuses a time that is not a Jira duration before anything is sent', async () => {
    await openEstimated()
    await section('Worklogs').getByRole('button', { name: 'Add worklog' }).click()
    await form('Add worklog').getByLabel('Time spent').fill('an hour')
    await form('Add worklog').getByRole('button', { name: 'Log work' }).click()
    await expect(form('Add worklog').getByRole('alert')).toContainText('Time spent must be')
    await expect(form('Add worklog').getByLabel('Time spent')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await window.keyboard.press('Escape')
    await expect(form('Add worklog')).toHaveCount(0)
    expect(await writes()).toBe(0)
  })

  test('keeps the form and says why when Jira refuses a worklog', async () => {
    await openEstimated()
    await refuseNextEdit(app)
    await logWork('1h', 'Refused')
    await settleRefused(1)
    await expect(form('Add worklog').getByRole('alert')).toContainText(
      'Could not save the worklog.',
    )
    await expect(form('Add worklog').getByLabel('Time spent')).toHaveValue('1h')
    await expect(estimate()).toHaveValue('2h')
  })

  test('edits a worklog, and Time remaining moves by the difference', async () => {
    await openEstimated()
    await logWork('30m', 'First')
    await settle(1)
    await expect(estimate()).toHaveValue('1h 30m')

    await section('Worklogs').getByRole('button', { name: 'Edit worklog' }).click()
    await form('Edit worklog').getByLabel('Time spent').fill('1h')
    await form('Edit worklog').getByRole('button', { name: 'Save' }).click()
    await expect.poll(writes).toBe(2)
    const sent = await lastBody()
    expect(sent).toMatchObject({ worklog: 'edit', adjustEstimate: 'auto', timeSpent: '1h' })
    // Only what changed goes: the start and the comment were left alone.
    expect(sent).not.toHaveProperty('started')
    expect(sent).not.toHaveProperty('comment')
    await releaseEdit(app)

    await expect(form('Edit worklog')).toHaveCount(0)
    await expect(props()).toContainText('Remaining estimate, read-only: 1h')
    await expect(estimate()).toHaveValue('1h')
  })

  test("offers Edit and Delete on the signed-in user's own worklog only", async () => {
    await openLogged()
    await expect(section('Worklogs').getByRole('button', { name: 'Edit worklog' })).toHaveCount(1)
    await expect(section('Worklogs').getByRole('button', { name: 'Delete worklog' })).toHaveCount(1)
  })

  test('deletes a worklog after the confirmation, and its time returns', async () => {
    await openEstimated()
    await logWork('30m', 'Gone soon')
    await settle(1)
    await expect(estimate()).toHaveValue('1h 30m')

    await section('Worklogs').getByRole('button', { name: 'Delete worklog' }).click()
    await expect(section('Worklogs').getByText('Delete this worklog?')).toBeVisible()
    expect(await writes()).toBe(1)
    await section('Worklogs').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(section('Worklogs').getByText('Gone soon')).toHaveCount(0)
    await settle(2)
    expect(await lastBody()).toMatchObject({ worklog: 'delete', adjustEstimate: 'auto' })
    await expect(estimate()).toHaveValue('2h')
  })
})

test.describe('worklogs with a comment that has no text', () => {
  const MEDIA_ONLY = {
    version: 1,
    type: 'doc',
    content: [
      {
        type: 'mediaSingle',
        attrs: { layout: 'center' },
        content: [{ type: 'media', attrs: { type: 'file', id: 'abc', collection: '' } }],
      },
    ],
  }

  for (const [name, comment] of [
    ['an empty document', { version: 1, type: 'doc', content: [] }],
    ['media only', MEDIA_ONLY],
  ] as const) {
    test(`edits a worklog whose comment is ${name}, and leaves the comment alone`, async () => {
      await addWorklog(app, 'PSAPAC-4', comment)
      await openEstimated()
      await section('Worklogs').getByRole('button', { name: 'Edit worklog' }).click()
      const form = section('Worklogs').getByRole('form', { name: 'Edit worklog' })
      await form.getByLabel('Time spent').fill('2h')
      await form.getByRole('button', { name: 'Save' }).click()

      await expect.poll(writes).toBe(1)
      const sent = await lastBody()
      expect(sent).toMatchObject({ worklog: 'edit', timeSpent: '2h' })
      expect(sent).not.toHaveProperty('comment')
      await releaseEdit(app)
      await expect(form).toHaveCount(0)
      await expect(section('Worklogs')).toContainText('2h')
    })
  }
})

test.describe('links', () => {
  const form = () => section('Links').getByRole('form', { name: 'Add link' })

  async function addLink(direction: string, key: string) {
    await section('Links').getByRole('button', { name: 'Add link' }).click()
    await form().getByLabel('Link type').selectOption({ label: direction })
    await form().getByLabel('Linked issue').fill(key)
    await form().getByRole('button', { name: 'Add link' }).click()
  }

  test('adds a link where this issue blocks the other, with this issue as the blocker', async () => {
    await openEstimated()
    await addLink('blocks', 'PSAPAC-2')
    await expect.poll(writes).toBe(1)
    expect(await lastBody()).toEqual({
      link: 'add',
      type: { id: '1' },
      inwardIssue: { key: 'PSAPAC-4' },
      outwardIssue: { key: 'PSAPAC-2' },
    })
    await releaseEdit(app)
    await expect(section('Links').getByRole('heading', { name: 'blocks' })).toBeVisible()
    await expect(
      section('Links').getByRole('button', { name: 'PSAPAC-2', exact: true }),
    ).toBeVisible()
  })

  test('adds a link where this issue is blocked by the other, with the other as the blocker', async () => {
    await openEstimated()
    await addLink('is blocked by', 'PSAPAC-3')
    await expect.poll(writes).toBe(1)
    expect(await lastBody()).toMatchObject({
      inwardIssue: { key: 'PSAPAC-3' },
      outwardIssue: { key: 'PSAPAC-4' },
    })
    await releaseEdit(app)
    await expect(section('Links').getByRole('heading', { name: 'is blocked by' })).toBeVisible()
  })

  test('puts the five common types above the rest in the type select', async () => {
    await openEstimated()
    await section('Links').getByRole('button', { name: 'Add link' }).click()
    const groups = await form()
      .getByLabel('Link type')
      .evaluate((select) =>
        Array.from(select.querySelectorAll('optgroup'), (group) => [
          group.label,
          Array.from(group.querySelectorAll('option'), (option) => option.textContent),
        ]),
      )
    expect(groups).toEqual([
      [
        'Common',
        [
          'blocks',
          'is blocked by',
          'relates to',
          'duplicates',
          'is duplicated by',
          'causes',
          'is caused by',
          'clones',
          'is cloned by',
        ],
      ],
      ['Other', ['implements', 'is idea for', 'causes', 'is caused by', 'tests', 'is tested by']],
    ])
  })

  test('refuses a link to an issue outside the project, and sends nothing', async () => {
    await openEstimated()
    await addLink('blocks', 'OTHER-1')
    await expect(form().getByRole('alert')).toContainText('Could not add the link.')
    await expect(form().getByRole('alert')).toContainText('OTHER-1 is not in PSAPAC')
    expect(await writes()).toBe(0)
  })

  test('keeps Add off for the issue itself and for text that is not a key', async () => {
    await openEstimated()
    await section('Links').getByRole('button', { name: 'Add link' }).click()
    const add = form().getByRole('button', { name: 'Add link' })
    await form().getByLabel('Linked issue').fill('PSAPAC-4')
    await expect(add).toBeDisabled()
    await form().getByLabel('Linked issue').fill('soon')
    await expect(add).toBeDisabled()
    await form().getByLabel('Linked issue').fill('psapac-2')
    await expect(add).toBeEnabled()
  })

  test('removes a link at once, and the other issue shows the removal too', async () => {
    await openStory()
    await section('Links').getByRole('button', { name: 'Remove link to PSAPAC-2' }).click()
    await expect(
      section('Links').getByRole('button', { name: 'PSAPAC-2', exact: true }),
    ).toHaveCount(0)
    await expect.poll(writes).toBe(1)
    expect(await lastBody()).toEqual({ link: 'remove', id: 9900 })
    await releaseEdit(app)
    await expect.poll(async () => (await counts(app)).applied).toBe(1)
    await expect(
      section('Links').getByRole('button', { name: 'PSAPAC-2', exact: true }),
    ).toHaveCount(0)
    await expect(
      section('Links').getByRole('button', { name: 'PSAPAC-3', exact: true }),
    ).toBeVisible()
  })

  test('puts a link back, and says why, when Jira refuses the removal', async () => {
    await openStory()
    await section('Links').getByRole('button', { name: 'Remove link to PSAPAC-2' }).click()
    await expect(
      section('Links').getByRole('button', { name: 'PSAPAC-2', exact: true }),
    ).toHaveCount(0)
    await refuseNextEdit(app)
    // The list read that follows the write waits, so only the rollback can put the link back.
    await holdReads(app)
    await settleRefused(1)
    await expect(
      section('Links').getByRole('button', { name: 'PSAPAC-2', exact: true }),
    ).toBeVisible()
    await expect(window.getByRole('alert')).toContainText('Could not remove the link')
    await releaseReads(app)
    await expect(
      section('Links').getByRole('button', { name: 'PSAPAC-2', exact: true }),
    ).toBeVisible()
  })

  test('opens the page of a linked issue', async () => {
    await openStory()
    await section('Links').getByRole('button', { name: 'PSAPAC-2', exact: true }).click()
    await expect(heading('Review the data model')).toBeVisible()
  })
})

test.describe('attachments', () => {
  test('downloads an attachment through the save dialog, under the name it offered', async () => {
    await openStory()
    await section('Attachments').getByRole('button', { name: 'Download report.xlsx' }).click()

    await expect(notices(window).getByText('Saved report.xlsx')).toBeVisible()
    expect((await counts(app)).downloads).toEqual(['report.xlsx'])
    const saved = await readFile(join(stateDir, 'downloads', 'report.xlsx'), 'utf8')
    expect(saved).toBe('xlsx-bytes')
  })

  test('writes nothing when the user cancels the save dialog', async () => {
    await openStory()
    await cancelNextDownload(app)
    await section('Attachments').getByRole('button', { name: 'Download report.xlsx' }).click()

    await expect.poll(async () => (await counts(app)).downloads).toEqual(['report.xlsx'])
    await expect(notices(window).getByText('Saved report.xlsx')).toHaveCount(0)
    await expect(readFile(join(stateDir, 'downloads', 'report.xlsx'))).rejects.toThrow()
  })

  test('drops a file on the Attachments zone and it attaches', async () => {
    await openEstimated()
    await expect(section('Attachments').getByText('No attachments')).toBeVisible()
    await dragFile(window.locator('body'), 'dragenter')
    await dragFile(attachZone(), 'drop')

    await expect.poll(async () => (await uploads()).length).toBe(1)
    expect((await uploads())[0]).toMatchObject({
      key: 'PSAPAC-4',
      filename: 'notes.txt',
      type: 'text/plain',
      size: 5,
    })
    await expect(section('Attachments').getByText('Uploading notes.txt')).toBeVisible()
    await releaseUpload(app)
    await expect(section('Attachments').getByText('Uploading notes.txt')).toHaveCount(0)
    await expect(section('Attachments').getByText('notes.txt', { exact: true })).toBeVisible()
    await expect(section('Attachments').getByText('5 B', { exact: true })).toBeVisible()
  })

  test('drops an image on the Attachments zone and it attaches without embedding', async () => {
    await openEstimated()
    await dragFile(attachZone(), 'drop', {
      name: 'shot.png',
      type: 'image/png',
      data: PNG,
    })
    await expect.poll(async () => (await uploads()).length).toBe(1)
    await releaseUpload(app)
    await expect(section('Attachments').getByText('shot.png', { exact: true })).toBeVisible()
    await expect(section('Description').getByRole('img')).toHaveCount(0)
    expect(await writes()).toBe(0)
  })

  test('both zones light up while a file is dragged over the page, and clear on leave', async () => {
    await openEstimated()
    const attachLabel = issuePage().getByText('Attach file to issue', { exact: true })
    const describeLabel = issuePage().getByText('Add images into description', { exact: true })
    await expect(attachLabel).toHaveCount(0)
    await expect(describeLabel).toHaveCount(0)

    await dragFile(window.locator('body'), 'dragenter')
    await expect(attachLabel).toBeVisible()
    await expect(describeLabel).toBeVisible()
    await expect(attachZone()).toBeVisible()
    await expect(describeZone()).toBeVisible()

    await dragFile(window.locator('body'), 'dragleave')
    await expect(attachLabel).toHaveCount(0)
    await expect(describeLabel).toHaveCount(0)
  })

  test('drops a file on the properties sidebar, outside both zones, and it attaches', async () => {
    await openEstimated()
    await dragFile(props(), 'drop')
    await expect.poll(async () => (await uploads()).length).toBe(1)
    expect((await uploads())[0]).toMatchObject({ key: 'PSAPAC-4', filename: 'notes.txt' })
    await releaseUpload(app)
    await expect(section('Attachments').getByText('notes.txt', { exact: true })).toBeVisible()
  })

  test('attaches a dropped file once, not once for the zone and once for the page', async () => {
    await openEstimated()
    await dragFile(attachZone(), 'drop')
    await expect.poll(async () => (await uploads()).length).toBe(1)
    await releaseUpload(app)
    await expect(section('Attachments').getByText('notes.txt', { exact: true })).toBeVisible()
    // A second attach of the same drop would queue behind the first and wait on the fake, so the
    // queue has drained only when no "Uploading" row is left.
    await expect(section('Attachments').getByText('Uploading notes.txt')).toHaveCount(0)
    expect(await uploads()).toHaveLength(1)
  })

  test('attaches queued files to the issue they were dropped on after another page opens', async () => {
    await openStory()
    await attachZone().evaluate((element) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File(['one'], 'first.txt', { type: 'text/plain' }))
      transfer.items.add(new File(['two'], 'second.txt', { type: 'text/plain' }))
      element.dispatchEvent(
        new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
      )
    })
    // The first upload is held, so the second waits in the queue.
    await expect.poll(async () => (await uploads()).length).toBe(1)
    await section('Links').getByRole('button', { name: 'PSAPAC-2', exact: true }).click()
    await expect(heading('Review the data model')).toBeVisible()
    await releaseUpload(app)
    await expect.poll(async () => (await uploads()).length).toBe(2)
    await releaseUpload(app)
    expect((await uploads()).map((u) => `${u.key} ${u.filename}`)).toEqual([
      'PSAPAC-1 first.txt',
      'PSAPAC-1 second.txt',
    ])
    // Neither file shows on the page that is open now.
    await expect(section('Attachments').getByText('No attachments')).toBeVisible()
  })

  test('a mixed drop on a comment editor embeds the image there and attaches only the other file', async () => {
    await openEstimated()
    await section('Activity')
      .getByRole('textbox', { name: 'New comment' })
      .evaluate((element, data) => {
        const transfer = new DataTransfer()
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
        transfer.items.add(new File([bytes], 'shot.png', { type: 'image/png' }))
        transfer.items.add(new File(['hello'], 'notes.txt', { type: 'text/plain' }))
        const box = element.getBoundingClientRect()
        element.dispatchEvent(
          new DragEvent('drop', {
            dataTransfer: transfer,
            bubbles: true,
            cancelable: true,
            clientX: box.left + 10,
            clientY: box.top + 10,
          }),
        )
      }, PNG)
    await expect.poll(async () => (await uploads()).length).toBe(2)
    await releaseUpload(app)
    await releaseUpload(app)
    // The page attached the text file and left the embedded image to the comment: no third upload.
    await expect(section('Attachments').getByText('Uploading notes.txt')).toHaveCount(0)
    await expect(section('Attachments').getByText('notes.txt', { exact: true })).toBeVisible()
    await expect(section('Attachments').getByText('shot.png', { exact: true })).toBeVisible()
    const names = (await uploads()).map((upload) => upload.filename).sort()
    expect(names).toEqual(['notes.txt', 'shot.png'])
  })

  test('drops a file that is not an image on the description and it attaches', async () => {
    await openEstimated()
    await dragFile(describeZone(), 'drop')
    await expect.poll(async () => (await uploads()).length).toBe(1)
    await releaseUpload(app)
    await expect(section('Attachments').getByText('notes.txt', { exact: true })).toBeVisible()
    expect(await writes()).toBe(0)
  })

  test('attaches a file chosen with the Attach file button', async () => {
    await openEstimated()
    await section('Attachments')
      .locator('input[type="file"]')
      .setInputFiles({
        name: 'chosen.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('a,b\n1,2\n'),
      })
    await expect.poll(async () => (await uploads()).length).toBe(1)
    expect((await uploads())[0]).toMatchObject({ filename: 'chosen.csv', type: 'text/csv' })
    await releaseUpload(app)
    await expect(section('Attachments').getByText('chosen.csv', { exact: true })).toBeVisible()
  })

  test('shows why an upload failed and keeps the page working', async () => {
    await openEstimated()
    await failUpload(app)
    await dragFile(attachZone(), 'drop')
    await expect(window.getByRole('alert')).toContainText('notes.txt was not attached')
    await expect(window.getByRole('alert')).toContainText('The fake failed this upload.')
    await expect(section('Attachments').getByText('Uploading notes.txt')).toHaveCount(0)
    await expect(section('Attachments').getByText('No attachments')).toBeVisible()
    await expect(heading('Migrate the dashboards')).toBeVisible()
  })

  test('lists an image embedded in the description as an attachment', async () => {
    await openEstimated()
    await dragFile(describeZone(), 'drop', {
      name: 'embed.png',
      type: 'image/png',
      data: PNG,
    })
    await expect.poll(async () => (await uploads()).length).toBe(1)
    await releaseUpload(app)
    await expect(section('Attachments').getByText('embed.png', { exact: true })).toBeVisible()
  })
})
