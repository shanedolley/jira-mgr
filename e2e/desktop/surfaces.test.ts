/// <reference lib="dom" />
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'

import { launch, logIn } from './harness.js'

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
const issuePage = () => window.getByRole('region', { name: 'Issue page' })

const TEXT_FILE = { name: 'notes.txt', type: 'text/plain', data: btoa('hello') }

/** Fires a dragenter carrying one file at the element, as a file dragged in from the desktop would. */
async function dragEnter(target: Locator) {
  await target.evaluate((element, [name, type, data]) => {
    const bytes = Uint8Array.from(atob(data ?? ''), (c) => c.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([bytes], name ?? 'a', { type: type ?? '' }))
    element.dispatchEvent(
      new DragEvent('dragenter', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    )
  }, Object.values(TEXT_FILE))
}

test.describe('scrim and shadow', () => {
  /** The alpha of a computed colour, in either of the notations Chromium prints. */
  const alpha = (colour: string) => Number(/(?:\/|,)\s*([\d.]+)\s*\)/.exec(colour)?.[1] ?? 1)

  test('the light scrim and shadow differ from the dark ones, and the light scrim dims less', async () => {
    await logIn(window)
    await expect(item(/PSAPAC-10,/)).toBeVisible()
    await expect(window.getByText('Loading Done issues:')).toBeVisible()
    await item(/PSAPAC-2,/).click()
    await window.keyboard.press('Escape')
    await expect(tree()).toBeFocused()
    await window.keyboard.press('c')
    await expect(window.getByRole('dialog')).toBeVisible()

    const read = () =>
      window.locator('dialog[open]').evaluate((element) => ({
        scrim: getComputedStyle(element, '::backdrop').backgroundColor,
        shadow: getComputedStyle(element).boxShadow,
      }))
    await window.emulateMedia({ colorScheme: 'light' })
    const light = await read()
    await window.emulateMedia({ colorScheme: 'dark' })
    const dark = await read()

    expect(alpha(light.scrim)).toBeGreaterThan(0)
    expect(alpha(light.scrim)).toBeLessThan(alpha(dark.scrim))
    expect(light.shadow).not.toBe(dark.shadow)
  })
})

test.describe('drop zone', () => {
  test('no legible content sits under a drop label while a file is dragged over the page', async () => {
    await logIn(window)
    await expect(item(/PSAPAC-10,/)).toBeVisible()
    await expect(window.getByText('Loading Done issues:')).toBeVisible()
    await item(/PSAPAC-1,/).click()
    await window.keyboard.press('Enter')
    await expect(
      issuePage().getByRole('heading', { name: 'Kick off the engagement' }),
    ).toBeVisible()
    await expect(issuePage().getByText('Loading attachments')).toHaveCount(0)

    await dragEnter(window.locator('body'))
    await expect(issuePage().getByText('Attach file to issue', { exact: true })).toBeVisible()

    // A label cannot clear every line of text under a zone, so what counts is how much of that
    // text shows through: the zone's content fades and the label's surface covers the rest.
    const collisions = await window.evaluate(() => {
      const LEGIBLE = 0.05
      const alphaOf = (colour: string) => Number(/\/\s*([\d.]+)\s*\)/.exec(colour)?.[1] ?? 1)
      return [...document.querySelectorAll<HTMLElement>('[data-drop-zone]')].map((zone) => {
        const label = zone.dataset.dropZone ?? ''
        const labelElement = [...zone.querySelectorAll<HTMLElement>('*')].find((element) =>
          [...element.childNodes].some(
            (node) => node.nodeType === Node.TEXT_NODE && node.nodeValue?.trim() === label,
          ),
        )
        if (labelElement === undefined) throw new Error(`No label "${label}" in its zone`)
        const text = [...labelElement.childNodes].find(
          (node) => node.nodeType === Node.TEXT_NODE && node.nodeValue?.trim() === label,
        )
        const range = document.createRange()
        range.selectNodeContents(text as Node)
        const labelBox = range.getBoundingClientRect()
        const cover = alphaOf(getComputedStyle(labelElement).backgroundColor)

        const leaves = [...zone.querySelectorAll<HTMLElement>('*')].filter(
          (element) =>
            !labelElement.contains(element) &&
            ![...element.childNodes].every(
              (node) => node.nodeType !== Node.TEXT_NODE || !node.nodeValue?.trim(),
            ),
        )
        const legible = leaves.filter((element) => {
          const box = element.getBoundingClientRect()
          const overlaps =
            box.left < labelBox.right &&
            box.right > labelBox.left &&
            box.top < labelBox.bottom &&
            box.bottom > labelBox.top
          let opacity = 1
          for (
            let node: HTMLElement | null = element;
            node !== null && node !== zone;
            node = node.parentElement
          ) {
            opacity *= Number(getComputedStyle(node).opacity)
          }
          return overlaps && opacity * (1 - cover) >= LEGIBLE
        })
        return { zone: label, leaves: leaves.length, legible: legible.map((e) => e.textContent) }
      })
    })

    expect(collisions).toHaveLength(2)
    for (const { zone, leaves, legible } of collisions) {
      expect(leaves, `${zone} holds text`).toBeGreaterThan(0)
      expect(legible, `${zone} has legible text under its label`).toEqual([])
    }
  })

  test('the label sits on an inset dashed accent border', async () => {
    await logIn(window)
    await expect(item(/PSAPAC-10,/)).toBeVisible()
    await item(/PSAPAC-4,/).click()
    await window.keyboard.press('Enter')
    await expect(issuePage()).toBeVisible()
    await dragEnter(window.locator('body'))
    const label = issuePage().getByText('Attach file to issue', { exact: true })
    await expect(label).toBeVisible()
    const style = await label.evaluate((element) => {
      const css = getComputedStyle(element)
      return { width: css.borderTopWidth, style: css.borderTopStyle }
    })
    expect(style).toEqual({ width: '2px', style: 'dashed' })
  })
})

test.describe('login', () => {
  test('shows the mark, the Keychain hint and a 400px form on the canvas colour', async () => {
    await expect(window.getByRole('heading', { name: 'Log in to Jira' })).toBeVisible()
    await expect(window.locator('[data-login-mark]')).toHaveText('jm')
    await expect(window.getByText('jira-mgr', { exact: true })).toBeVisible()
    await expect(window.getByText('The token stays in your macOS Keychain.')).toBeVisible()

    const form = await window.locator('form').boundingBox()
    expect(form?.width).toBe(400)

    for (const colorScheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme })
      const colours = await window.evaluate(() => {
        const probe = document.createElement('div')
        probe.style.background = 'var(--canvas)'
        document.body.append(probe)
        const canvas = getComputedStyle(probe).backgroundColor
        probe.remove()
        return {
          canvas,
          main: getComputedStyle(document.querySelector('main') as Element).backgroundColor,
        }
      })
      expect(colours.main, `${colorScheme} main background`).toBe(colours.canvas)
    }
  })
})
