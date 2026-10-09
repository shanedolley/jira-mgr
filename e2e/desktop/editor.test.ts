/// <reference lib="dom" />
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'

import {
  counts,
  dropIssue,
  failUpload,
  launch,
  logIn,
  normaliseDescriptions,
  refuseNextEdit,
  releaseDone,
  releaseEdit,
  releaseUpload,
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
  // A draft left in the editor would raise the quit prompt, which Playwright would then wait on.
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
const heading = (name: string) => issuePage().getByRole('heading', { name })
/** The Description region while editing. */
const editor = () => issuePage().getByRole('textbox', { name: 'Description' })
/** The Description region in either mode. */
const body = () => issuePage().locator('.adf-editor')
const editButton = (name: string | RegExp = /^(Edit|Add) description$/) =>
  issuePage().getByRole('button', { name })
const save = () => issuePage().getByRole('button', { name: 'Save', exact: true })
const cancel = () => issuePage().getByRole('button', { name: 'Cancel', exact: true })
const discardDialog = () => window.getByRole('alertdialog')
const MOD = 'ControlOrMeta'

/** A 1 by 1 PNG, so an image has a real size to decode. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
}

/** Opens the full page of the issue whose row matches, with Enter. */
async function openPage(row: RegExp, title: string) {
  await open()
  await openFromTree(row, title)
}

async function openFromTree(row: RegExp, title: string) {
  await item(row).click()
  await window.keyboard.press('Enter')
  await expect(heading(title)).toBeVisible()
  await expect(window.getByText('Loading description')).toHaveCount(0)
}

const edits = async () => (await counts(app)).edits
const lastBody = async () =>
  ((await counts(app)).editBodies.at(-1) as { fields: { description: Doc | null } }).fields
    .description

interface Node {
  type: string
  attrs?: Record<string, unknown>
  content?: Node[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}
interface Doc extends Node {
  version: number
}

/** Waits for the write, then lets the fake Jira answer it and the page read the issue again. */
async function settle(expected: number) {
  await expect.poll(edits).toBe(expected)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(expected)
}

/** Drops a PNG on the editor, as a file dragged in from the desktop. */
async function dropImage(target: Locator, name = 'shot.png') {
  await target.evaluate(
    (element, [data, filename]) => {
      const bytes = Uint8Array.from(atob(data ?? ''), (c) => c.charCodeAt(0))
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], filename ?? 'a.png', { type: 'image/png' }))
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
    },
    [PNG, name],
  )
}

/** Starts editing the description of PSAPAC-4, which has none. */
async function addDescription() {
  await openPage(/PSAPAC-4,/, 'Migrate the dashboards')
  await editButton('Add description').click()
  await expect(editor()).toBeFocused()
}

/** Starts editing PSAPAC-1, whose description holds a panel, a table, a mention, linked code and an image. */
async function editRich() {
  await openPage(/PSAPAC-1,/, 'Kick off the engagement')
  await editButton('Edit description').click()
  await expect(editor()).toBeFocused()
}

const panel = (): Node => ({
  type: 'panel',
  attrs: { panelType: 'info' },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Panel kept as it is.' }] }],
})
const table = (): Node => ({
  type: 'table',
  attrs: { isNumberColumnEnabled: false, layout: 'default' },
  content: [
    {
      type: 'tableRow',
      content: [
        {
          type: 'tableCell',
          attrs: {},
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell A' }] }],
        },
        {
          type: 'tableCell',
          attrs: {},
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell B' }] }],
        },
      ],
    },
  ],
})
const mentionParagraph = (): Node => ({
  type: 'paragraph',
  content: [
    { type: 'text', text: 'Ask ' },
    { type: 'mention', attrs: { id: 'u2', text: '@Other User' } },
    { type: 'text', text: ' to run ' },
    {
      type: 'text',
      text: 'make test',
      // ProseMirror keeps marks in its own order, and ADF takes them in any.
      marks: [{ type: 'link', attrs: { href: 'https://example.test/docs' } }, { type: 'code' }],
    },
    { type: 'text', text: '.' },
  ],
})

/** Puts the caret at the end of the first paragraph of the rich description. */
async function endOfFirstParagraph() {
  // A pause between press and release, as a hand makes: a click with none can go unseen by ProseMirror.
  await editor().getByText('Agree the scope with the sponsor.').click({ delay: 60 })
  await window.keyboard.press('End')
}

test('writes a heading, a list and bold text with markdown shortcuts and saves them with Cmd+Enter', async () => {
  await addDescription()

  await window.keyboard.type('# Plan\n- first\nsecond\n\n**bold** text')
  await window.keyboard.press(`${MOD}+Enter`)

  await expect.poll(edits).toBe(1)
  const description = await lastBody()
  expect(description?.content).toEqual([
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Plan' }] },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }],
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }],
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
        { type: 'text', text: ' text' },
      ],
    },
  ])
  await releaseEdit(app)
  await expect(issuePage().getByRole('heading', { name: 'Plan' })).toBeVisible()
})

test('saves the panel, table and mention unchanged when a paragraph beside them is edited', async () => {
  await editRich()
  await endOfFirstParagraph()
  await window.keyboard.type(' Done.')
  await window.keyboard.press(`${MOD}+Enter`)

  await expect.poll(edits).toBe(1)
  const content = (await lastBody())?.content ?? []
  expect(content.map((node) => node.type)).toEqual([
    'paragraph',
    'panel',
    'table',
    'paragraph',
    'mediaSingle',
  ])
  expect(content[0]).toEqual({
    type: 'paragraph',
    attrs: { localId: 'p-scope' },
    content: [{ type: 'text', text: 'Agree the scope with the sponsor. Done.' }],
  })
  expect(content[1]).toEqual(panel())
  expect(content[2]).toEqual(table())
  expect(content[3]).toEqual(mentionParagraph())
  expect(content[4]?.content?.[0]?.attrs?.id).toBe('aaaaaaaa-0000-4000-8000-000000005001')
})

test('splitting a paragraph sends one localId, not two', async () => {
  await editRich()
  await endOfFirstParagraph()
  await window.keyboard.press('Enter')
  await window.keyboard.type('Second paragraph')
  await window.keyboard.press(`${MOD}+Enter`)

  await expect.poll(edits).toBe(1)
  const sent = JSON.stringify((await counts(app)).editBodies.at(-1))
  expect(sent.match(/p-scope/g)).toHaveLength(1)
  const content = (await lastBody())?.content ?? []
  expect(content[0]?.attrs).toEqual({ localId: 'p-scope' })
  expect(content[1]).toEqual({
    type: 'paragraph',
    content: [{ type: 'text', text: 'Second paragraph' }],
  })
})

test('cannot type inside a read-only block, but can delete it', async () => {
  await editRich()
  const block = editor().getByRole('group', { name: 'Panel, read-only. Edit it in Jira.' })
  await expect(block).toBeVisible()
  await expect(block).toHaveAttribute('contenteditable', 'false')
  await expect(block.locator('[contenteditable="true"]')).toHaveCount(0)

  await block.click()
  await window.keyboard.press('Backspace')
  await expect(block).toHaveCount(0)
  await window.keyboard.press(`${MOD}+Enter`)

  await expect.poll(edits).toBe(1)
  const types = ((await lastBody())?.content ?? []).map((node) => node.type)
  expect(types).toEqual(['paragraph', 'table', 'paragraph', 'mediaSingle'])
})

test('shows the saved description before Jira answers, and reopens the draft when Jira refuses', async () => {
  await addDescription()
  await window.keyboard.type('Draft text')
  await refuseNextEdit(app)
  await window.keyboard.press(`${MOD}+Enter`)

  // The write is held: the page already shows the new description and is no longer editing.
  await expect.poll(edits).toBe(1)
  await expect(editor()).toHaveCount(0)
  await expect(body()).toContainText('Draft text')
  await expect(editButton('Saving')).toBeDisabled()

  await releaseEdit(app)
  await expect(issuePage().getByRole('alert')).toContainText(
    'Could not save the description, so Jira still holds the old one.',
  )
  await expect(editor()).toContainText('Draft text')
  await expect(editor()).toBeFocused()
})

test('keeps Edit disabled until the re-read lands, so a quick second save against a normalising Jira raises no conflict', async () => {
  await normaliseDescriptions(app)
  await editRich()
  await endOfFirstParagraph()
  await window.keyboard.type(' One.')
  await window.keyboard.press(`${MOD}+Enter`)
  await expect.poll(edits).toBe(1)
  await expect(editButton('Saving')).toBeDisabled()
  await releaseEdit(app)
  await expect(editButton('Edit description')).toBeEnabled()

  // Jira stored the paragraphs with localIds the editor never wrote. The base is that form.
  await editButton('Edit description').click()
  await endOfFirstParagraph()
  await window.keyboard.type(' Two.')
  await window.keyboard.press(`${MOD}+Enter`)
  await expect.poll(edits).toBe(2)
  await expect(issuePage().getByRole('alert')).toHaveCount(0)
  await releaseEdit(app)
  await expect(body()).toContainText('One. Two.')
})

/** Changes the rich description in Jira as another person, then edits it here and saves into the clash. */
async function clash() {
  await editRich()
  await endOfFirstParagraph()
  await window.keyboard.type(' Mine.')
  await setDescription(app, 'PSAPAC-1', {
    version: 1,
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Theirs.' }] }],
  })
  await window.keyboard.press(`${MOD}+Enter`)
}

test('offers Save mine anyway and Discard mine when the description changed in Jira', async () => {
  await clash()

  const alert = issuePage().getByRole('alert').filter({ hasText: 'changed in Jira' })
  await expect(alert).toContainText("PSAPAC-1's description changed in Jira while you edited.")
  await expect(alert.getByRole('button', { name: 'Save mine anyway' })).toBeVisible()
  await expect(alert.getByRole('button', { name: 'Discard mine' })).toBeVisible()
  // Nothing was written, and the draft is still in the editor.
  expect(await edits()).toBe(0)
  await expect(editor()).toContainText('Agree the scope with the sponsor. Mine.')
})

test("Save mine anyway overwrites Jira's description with the draft", async () => {
  await clash()
  await issuePage().getByRole('button', { name: 'Save mine anyway' }).click()

  await expect.poll(edits).toBe(1)
  const content = (await lastBody())?.content ?? []
  expect(content[0]?.content?.[0]?.text).toBe('Agree the scope with the sponsor. Mine.')
  await releaseEdit(app)
  await expect(body()).toContainText('Agree the scope with the sponsor. Mine.')
  await expect(body()).not.toContainText('Theirs.')
})

test("Discard mine shows Jira's description and drops the draft", async () => {
  await clash()
  await issuePage().getByRole('button', { name: 'Discard mine' }).click()

  await expect(editor()).toHaveCount(0)
  await expect(body()).toContainText('Theirs.')
  await expect(body()).not.toContainText('Mine.')
  expect(await edits()).toBe(0)
  // The draft is gone: editing again starts from Jira's text with no restore note.
  await editButton('Edit description').click()
  await expect(issuePage().getByText('Unsaved draft restored.')).toHaveCount(0)
  await expect(editor()).toContainText('Theirs.')
})

test('embeds a dropped image inline and saves a mediaSingle with its media id', async () => {
  await addDescription()
  await window.keyboard.type('See below')
  await dropImage(editor())

  await expect.poll(async () => (await counts(app)).uploads.length).toBe(1)
  expect((await counts(app)).uploads[0]).toMatchObject({
    key: 'PSAPAC-4',
    filename: 'shot.png',
    type: 'image/png',
  })
  await expect(editor().getByRole('status')).toContainText('Uploading shot.png')
  await expect(save()).toBeDisabled()

  await releaseUpload(app)
  const image = editor().locator('img')
  await expect(image).toBeVisible()
  await expect(editor().getByRole('status')).toHaveCount(0)
  await expect(save()).toBeEnabled()
  // Fetched through main and shown from a blob URL.
  await expect(image).toHaveAttribute('src', /^blob:/)
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0)

  await window.keyboard.press(`${MOD}+Enter`)
  await expect.poll(edits).toBe(1)
  const single = ((await lastBody())?.content ?? []).find((node) => node.type === 'mediaSingle')
  expect(single).toEqual({
    type: 'mediaSingle',
    attrs: { layout: 'center' },
    content: [
      {
        type: 'media',
        attrs: {
          type: 'file',
          id: 'aaaaaaaa-0000-4000-8000-000000006000',
          collection: '',
          alt: 'shot.png',
          width: 1,
          height: 1,
        },
      },
    ],
  })
})

test('undoing an image during its upload drops it, and the save holds no image', async () => {
  await addDescription()
  await window.keyboard.type('Before')
  await dropImage(editor())
  await expect.poll(async () => (await counts(app)).uploads.length).toBe(1)
  await expect(editor().getByRole('status')).toBeVisible()

  await editor().focus()
  await window.keyboard.press(`${MOD}+z`)
  await expect(editor().getByRole('status')).toHaveCount(0)
  await releaseUpload(app)
  await window.keyboard.press(`${MOD}+Enter`)

  await expect.poll(edits).toBe(1)
  const types = ((await lastBody())?.content ?? []).map((node) => node.type)
  expect(types).not.toContain('mediaSingle')
  expect(JSON.stringify(await lastBody())).toContain('Before')
})

test('an image uploading when the user leaves the page is embedded when the draft is restored', async () => {
  await addDescription()
  await dropImage(editor())
  await expect.poll(async () => (await counts(app)).uploads.length).toBe(1)

  await issuePage().getByRole('button', { name: 'Back to issues' }).click()
  await expect(issuePage()).toHaveCount(0)
  await releaseUpload(app)

  await item(/PSAPAC-4,/).click()
  await window.keyboard.press('Enter')
  await expect(issuePage().getByText('Unsaved draft restored.')).toBeVisible()
  await expect(editor().locator('img')).toBeVisible()
  await expect(editor().getByRole('status')).toHaveCount(0)
  await expect(save()).toBeEnabled()

  await save().click()
  await expect.poll(edits).toBe(1)
  const types = ((await lastBody())?.content ?? []).map((node) => node.type)
  expect(types).toContain('mediaSingle')
})

test('shows an upload failure on the image and keeps Save disabled until it is removed', async () => {
  await addDescription()
  await window.keyboard.type('Text')
  await failUpload(app)
  await dropImage(editor())

  const alert = editor().getByRole('alert')
  await expect(alert).toContainText('Could not upload shot.png.')
  await expect(save()).toBeDisabled()

  await alert.getByRole('button', { name: 'Remove' }).click()
  await expect(editor().getByRole('alert')).toHaveCount(0)
  await expect(save()).toBeEnabled()
})

test('shows an existing image fetched through main as a blob URL', async () => {
  await openPage(/PSAPAC-1,/, 'Kick off the engagement')
  const image = body().locator('img')
  await expect(image).toBeVisible()
  await expect(image).toHaveAttribute('src', /^blob:/)
  await expect(image).toHaveAttribute('alt', 'diagram.png')
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0)
})

test('a click on a link in read mode opens it once; a plain click while editing opens nothing; Cmd+click opens it once', async () => {
  await openPage(/PSAPAC-1,/, 'Kick off the engagement')
  const link = body().getByText('make test')
  const opened = async () => (await counts(app)).openExternal

  await link.click()
  await expect.poll(opened).toEqual(['https://example.test/docs'])
  // Reading, a click on a link does not start an edit.
  await expect(editor()).toHaveCount(0)

  await editButton('Edit description').click()
  await link.click()
  await window.keyboard.press('ArrowRight')
  expect(await opened()).toHaveLength(1)

  await link.click({ modifiers: [MOD] })
  await expect.poll(opened).toEqual(['https://example.test/docs', 'https://example.test/docs'])
})

test('Esc leaves an unchanged edit, and a second Esc returns to the Tree', async () => {
  await addDescription()
  await window.keyboard.press('Escape')

  await expect(editor()).toHaveCount(0)
  await expect(issuePage()).toBeFocused()
  await expect(issuePage()).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(issuePage()).toHaveCount(0)
  await expect(tree()).toBeFocused()
})

test('Esc on a changed draft opens the discard dialog; Esc there keeps editing; Discard drops the draft', async () => {
  await addDescription()
  await window.keyboard.type('Half a thought')
  await window.keyboard.press('Escape')

  await expect(discardDialog()).toContainText('Discard your changes to the description?')
  await expect(discardDialog().getByRole('button', { name: 'Keep editing' })).toBeFocused()
  await window.keyboard.press('Escape')
  await expect(discardDialog()).toHaveCount(0)
  await expect(editor()).toContainText('Half a thought')
  await expect(editor()).toBeFocused()
  // The page did not go back, and the edit was not cancelled.
  await expect(issuePage()).toBeVisible()

  await window.keyboard.press('Escape')
  await discardDialog().getByRole('button', { name: 'Discard' }).click()
  await expect(editor()).toHaveCount(0)
  await expect(issuePage().getByText('No description')).toBeVisible()
  expect(await edits()).toBe(0)
  await editButton('Add description').click()
  await expect(issuePage().getByText('Unsaved draft restored.')).toHaveCount(0)
})

test('restores an unsaved draft after opening another issue and coming back, with the caret at the end', async () => {
  await addDescription()
  await window.keyboard.type('Remember this')
  await issuePage().getByRole('button', { name: 'Back to issues' }).click()
  await expect(issuePage()).toHaveCount(0)

  await openFromTree(/PSAPAC-3,/, 'Fix the export timeout')
  await issuePage().getByRole('button', { name: 'Back to issues' }).click()
  await openFromTree(/PSAPAC-4,/, 'Migrate the dashboards')

  await expect(issuePage().getByText('Unsaved draft restored.')).toBeVisible()
  await expect(editor()).toContainText('Remember this')
  await expect(editor()).toBeFocused()
  await window.keyboard.type(' always')
  await expect(editor()).toContainText('Remember this always')
})

test('a failed save reopens with the caret where it was and Cmd+Z undoing the last change', async () => {
  await addDescription()
  await refuseNextEdit(app)
  await window.keyboard.type('abc')
  // Saved straight after the caret moves, before the browser reports the move to the editor.
  await window.keyboard.press('ArrowLeft')
  await window.keyboard.press(`${MOD}+Enter`)
  await expect.poll(edits).toBe(1)
  await releaseEdit(app)
  await expect(issuePage().getByRole('alert')).toContainText('Could not save the description')

  await expect(editor()).toBeFocused()
  await window.keyboard.type('X')
  await expect(editor()).toContainText('abXc')
  // The editor's own history survived the save, so undo removes what was just typed. A new
  // editor would have no history and leave the X where it is.
  await window.keyboard.press(`${MOD}+z`)
  await expect(editor()).not.toContainText('X')
})

test('quitting with an unsaved draft raises the quit prompt', async () => {
  await addDescription()
  const blocksUnload = () => window.evaluate(() => typeof globalThis.onbeforeunload === 'function')
  expect(await blocksUnload()).toBe(false)
  await window.keyboard.type('Unsaved words')
  // The renderer asks to block the unload only while a draft exists.
  await expect.poll(blocksUnload).toBe(true)
  expect((await counts(app)).quitPrompts).toBe(0)

  // Playwright answers a real beforeunload dialog itself, so this raises the event Electron
  // sends main when the page blocks an unload, and checks what main does with it.
  const allowed = await app.evaluate(({ BrowserWindow }) => {
    let prevented = false
    BrowserWindow.getAllWindows()[0]?.webContents.emit('will-prevent-unload', {
      preventDefault: () => {
        prevented = true
      },
    })
    return prevented
  })
  expect(allowed).toBe(true)
  expect((await counts(app)).quitPrompts).toBe(1)

  // Once the draft is discarded, nothing blocks a quit.
  await window.keyboard.press('Escape')
  await discardDialog().getByRole('button', { name: 'Discard' }).click()
  await expect.poll(blocksUnload).toBe(false)
})

test('logging out with an unsaved draft asks first, then removes it', async () => {
  await addDescription()
  await window.keyboard.type('Unsaved words')
  const logout = window
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Log out' })

  await logout.click()
  await expect(discardDialog()).toContainText('Log out and discard 1 unsaved description?')
  await discardDialog().getByRole('button', { name: 'Keep editing' }).click()
  await expect(discardDialog()).toHaveCount(0)
  await expect(editor()).toContainText('Unsaved words')

  await logout.click()
  await discardDialog().getByRole('button', { name: 'Discard and log out' }).click()
  await expect(window.getByLabel('Site URL')).toBeVisible()

  await releaseDone(app)
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await openFromTree(/PSAPAC-4,/, 'Migrate the dashboards')
  await expect(issuePage().getByText('No description')).toBeVisible()
  await expect(issuePage().getByText('Unsaved draft restored.')).toHaveCount(0)
})

test('edits, saves and cancels by keyboard alone, tabbing out of a list to Save and Cancel', async () => {
  await openPage(/PSAPAC-4,/, 'Migrate the dashboards')
  await editButton('Add description').focus()
  await window.keyboard.press('Enter')
  await expect(editor()).toBeFocused()

  await window.keyboard.type('Plain words')
  await window.keyboard.press('Tab')
  await expect(save()).toBeFocused()
  await window.keyboard.press('Tab')
  await expect(cancel()).toBeFocused()
  await window.keyboard.press('Shift+Tab')
  await window.keyboard.press('Enter')

  await settle(1)
  await expect(body()).toContainText('Plain words')
  await expect(issuePage()).toBeFocused()
})

test('pasting HTML from another app cannot plant a mention or any other node', async () => {
  await addDescription()
  await editor().evaluate((element) => {
    const transfer = new DataTransfer()
    const planted = JSON.stringify({ type: 'mention', attrs: { id: 'u9', text: '@Evil' } })
    transfer.setData(
      'text/html',
      `<p>hello <span data-adfinline="" data-adf='${planted}'>there</span></p>`,
    )
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
    )
  })
  await expect(editor()).toContainText('hello there')
  await expect(editor().getByText('@Evil')).toHaveCount(0)

  await window.keyboard.press(`${MOD}+Enter`)
  await expect.poll(edits).toBe(1)
  expect(JSON.stringify(await lastBody())).not.toContain('mention')
})

test('an edit with nothing typed leaves Save off and writes nothing', async () => {
  await editRich()
  await expect(save()).toBeDisabled()
  await window.keyboard.press(`${MOD}+Enter`)
  // A round trip to the page, so a write that was going to start has started.
  await window.evaluate(() => 1)
  await expect(save()).toBeDisabled()
  expect(await edits()).toBe(0)
})

test('typing and then deleting it again is no change, so Esc closes with no dialog', async () => {
  await editRich()
  await endOfFirstParagraph()
  await window.keyboard.type('x')
  await expect(save()).toBeEnabled()
  await window.keyboard.press('Backspace')
  await expect(save()).toBeDisabled()
  await window.keyboard.press('Escape')
  await expect(discardDialog()).toHaveCount(0)
  await expect(editor()).toHaveCount(0)
  expect(await edits()).toBe(0)
})

test('cutting and pasting an image during its upload keeps the upload', async () => {
  await addDescription()
  await window.keyboard.type('Text')
  await dropImage(editor())
  await expect.poll(async () => (await counts(app)).uploads.length).toBe(1)
  const uploading = editor().getByRole('status')
  await expect(uploading).toBeVisible()

  await editor().locator('figure').click({ delay: 60 })
  await window.keyboard.press(`${MOD}+x`)
  await expect(uploading).toHaveCount(0)
  await window.keyboard.press(`${MOD}+v`)
  await expect(uploading).toBeVisible()

  await releaseUpload(app)
  await expect(editor().locator('img')).toBeVisible()
  await expect(save()).toBeEnabled()
  await window.keyboard.press(`${MOD}+Enter`)
  await expect.poll(edits).toBe(1)
  const types = ((await lastBody())?.content ?? []).map((node) => node.type)
  expect(types).toContain('mediaSingle')
})

test('Cmd+Z after a description save restores the previous description', async () => {
  await addDescription()
  await window.keyboard.type('Added text')
  await window.keyboard.press(`${MOD}+Enter`)
  await settle(1)
  await expect(body()).toContainText('Added text')
  await expect(issuePage()).toBeFocused()

  await window.keyboard.press(`${MOD}+z`)
  await expect.poll(edits).toBe(2)
  expect(await lastBody()).toBeNull()
  await releaseEdit(app)
  await expect(issuePage().getByText('No description')).toBeVisible()
  await expect(window.getByText('Undid PSAPAC-4: description back to empty')).toBeVisible()
})

test("removing a pasted copy of another issue's upload leaves that upload running", async () => {
  await addDescription()
  await window.keyboard.type('Text')
  await dropImage(editor())
  await expect.poll(async () => (await counts(app)).uploads.length).toBe(1)
  await expect(editor().getByRole('status')).toBeVisible()
  await editor().locator('figure').click({ delay: 60 })
  await window.keyboard.press(`${MOD}+c`)
  await issuePage().getByRole('button', { name: 'Back to issues' }).click()
  await expect(issuePage()).toHaveCount(0)

  // The copy lands in another issue's editor, where the upload is not its own.
  await openFromTree(/PSAPAC-1,/, 'Kick off the engagement')
  await editButton('Edit description').click()
  await expect(editor()).toBeFocused()
  await window.keyboard.press(`${MOD}+v`)
  const lost = editor().getByRole('alert')
  await expect(lost).toContainText('Could not upload')
  await lost.getByRole('button', { name: 'Remove' }).click()
  await expect(lost).toHaveCount(0)
  await issuePage().getByRole('button', { name: 'Back to issues' }).click()

  // PSAPAC-4's upload was not cancelled: it finishes, and its draft saves the image.
  await releaseUpload(app)
  await openFromTree(/PSAPAC-4,/, 'Migrate the dashboards')
  await expect(editor().locator('img')).toBeVisible()
  await expect(save()).toBeEnabled()
  await save().click()
  await expect.poll(edits).toBe(1)
  const types = ((await lastBody())?.content ?? []).map((node) => node.type)
  expect(types).toContain('mediaSingle')
})

/** Fires a drag event carrying one file at the element, as a file dragged in from the desktop would. */
async function dragFile(
  target: Locator,
  type: 'dragenter' | 'dragleave' | 'drop',
  file: { name: string; type: string; data: string } = {
    name: 'shot.png',
    type: 'image/png',
    data: PNG,
  },
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

const zone = () => issuePage().locator('[data-drop-zone="Add images into description"]')
const zoneLabel = () => issuePage().getByText('Add images into description')

test('lights up the description while a file is dragged over the page, and clears on leave and Esc', async () => {
  await openPage(/PSAPAC-4,/, 'Migrate the dashboards')
  await expect(zoneLabel()).toHaveCount(0)

  await dragFile(window.locator('body'), 'dragenter')
  await expect(zoneLabel()).toBeVisible()
  await dragFile(window.locator('body'), 'dragleave')
  await expect(zoneLabel()).toHaveCount(0)

  await dragFile(window.locator('body'), 'dragenter')
  await expect(zoneLabel()).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(zoneLabel()).toHaveCount(0)
  // Esc ended the drag and did not also leave the page.
  await expect(heading('Migrate the dashboards')).toBeVisible()
})

test('drops an image onto the read-mode description, which opens the editor with the upload', async () => {
  await openPage(/PSAPAC-4,/, 'Migrate the dashboards')
  await dragFile(window.locator('body'), 'dragenter')
  await expect(zoneLabel()).toBeVisible()
  await dragFile(zone(), 'drop')

  await expect(zoneLabel()).toHaveCount(0)
  await expect.poll(async () => (await counts(app)).uploads.length).toBe(1)
  await expect(editor().getByRole('status')).toContainText('Uploading shot.png')
  await releaseUpload(app)
  await expect(editor().locator('img')).toBeVisible()
  await expect(save()).toBeEnabled()
  await save().click()
  await expect.poll(edits).toBe(1)
  const types = ((await lastBody())?.content ?? []).map((node) => node.type)
  expect(types).toContain('mediaSingle')
})

test('refuses a file that is not an image dropped on the read-mode description', async () => {
  await openPage(/PSAPAC-4,/, 'Migrate the dashboards')
  await dragFile(zone(), 'drop', { name: 'notes.txt', type: 'text/plain', data: btoa('hello') })

  await expect(window.getByText('notes.txt was not added')).toBeVisible()
  await expect(editor()).toHaveCount(0)
  expect((await counts(app)).uploads).toHaveLength(0)
  expect(await edits()).toBe(0)
})

test('falls back to the Tree when the issue on the page no longer exists', async () => {
  await openPage(/PSAPAC-4,/, 'Migrate the dashboards')
  await dropIssue(app, 'PSAPAC-4')
  // The next window focus reads the issue again.
  await app.evaluate(({ BrowserWindow }) => {
    const [first] = BrowserWindow.getAllWindows()
    first?.emit('blur')
    first?.emit('focus')
  })
  await expect(issuePage()).toHaveCount(0)
  await expect(window.getByText('PSAPAC-4 no longer exists')).toBeVisible()
  await expect(tree()).toBeVisible()
})

test('a page that falls back for a missing issue drops its draft, so a quit is not held up', async () => {
  await addDescription()
  await window.keyboard.type('Words that will be lost')
  const blocksUnload = () => window.evaluate(() => typeof globalThis.onbeforeunload === 'function')
  await expect.poll(blocksUnload).toBe(true)

  await dropIssue(app, 'PSAPAC-4')
  await app.evaluate(({ BrowserWindow }) => {
    const [first] = BrowserWindow.getAllWindows()
    first?.emit('blur')
    first?.emit('focus')
  })
  await expect(issuePage()).toHaveCount(0)
  await expect(window.getByText('Its unsaved description was dropped.')).toBeVisible()
  await expect.poll(blocksUnload).toBe(false)
})

test('a mixed drop on the editor embeds the image and reports the other file', async () => {
  await addDescription()
  await editor().evaluate((element, data) => {
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

  await expect.poll(async () => (await counts(app)).uploads.length).toBe(1)
  await expect(window.getByText('notes.txt was not added')).toBeVisible()
})

test('a read-mode drop keeps its draft against the description Jira holds now', async () => {
  await openPage(/PSAPAC-4,/, 'Migrate the dashboards')
  // Someone adds a description in Jira; the next focus reads it, so the page's base is the new one.
  await setDescription(app, 'PSAPAC-4', {
    version: 1,
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Theirs.' }] }],
  })
  await app.evaluate(({ BrowserWindow }) => {
    const [first] = BrowserWindow.getAllWindows()
    first?.emit('blur')
    first?.emit('focus')
  })
  await expect(body()).toContainText('Theirs.')

  await dragFile(zone(), 'drop')
  await expect.poll(async () => (await counts(app)).uploads.length).toBe(1)
  // Leave before the upload ends, so the draft kept at the drop is the one that comes back.
  await issuePage().getByRole('button', { name: 'Back to issues' }).click()
  await releaseUpload(app)
  await openFromTree(/PSAPAC-4,/, 'Migrate the dashboards')
  await expect(issuePage().getByText('Unsaved draft restored.')).toBeVisible()
  await expect(editor().locator('img')).toBeVisible()

  // Saved against a stale base this would be called a conflict with Jira's own text.
  await save().click()
  await expect.poll(edits).toBe(1)
  await expect(issuePage().getByRole('alert')).toHaveCount(0)
})

test('the drop highlight clears when a drag leaves to nothing or the window loses focus', async () => {
  await openPage(/PSAPAC-4,/, 'Migrate the dashboards')
  const page = window.locator('body')
  // Two enters, one leave to nothing: the count says still inside, the target says outside.
  await dragFile(page, 'dragenter')
  await dragFile(page, 'dragenter')
  await dragFile(page, 'dragleave')
  await expect(zoneLabel()).toHaveCount(0)

  await dragFile(page, 'dragenter')
  await expect(zoneLabel()).toBeVisible()
  await window.evaluate(() => {
    globalThis.dispatchEvent(new Event('blur'))
  })
  await expect(zoneLabel()).toHaveCount(0)
})
