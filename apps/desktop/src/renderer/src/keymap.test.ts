import { describe, expect, it } from 'vitest'

import { keepsLetters, resolveKey, type KeyEvent, type KeyTarget } from './keymap'

const key = (name: string, extra: Partial<KeyEvent> = {}): KeyEvent => ({
  key: name,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  defaultPrevented: false,
  repeat: false,
  isComposing: false,
  ...extra,
})

/** A target that sits inside an element matching `selector`, and no other. */
const inside = (selector: string): KeyTarget => ({
  closest: (list) => (list.split(', ').includes(selector) ? {} : null),
})
const nowhere: KeyTarget = { closest: () => null }

describe('the letter shortcuts', () => {
  it('map C, S, A, L, P and E, in either case', () => {
    const expected = {
      c: 'create',
      s: 'status',
      a: 'assignee',
      l: 'labels',
      p: 'priority',
      e: 'edit',
    }
    for (const [letter, command] of Object.entries(expected)) {
      expect(resolveKey(key(letter), nowhere)).toBe(command)
      expect(resolveKey(key(letter.toUpperCase(), { shiftKey: true }), nowhere)).toBe(command)
    }
  })

  it('leave every other key to the control that has it', () => {
    for (const other of ['x', 'j', 'k', ' ', 'Enter', 'ArrowDown', 'constructor']) {
      expect(resolveKey(key(other), nowhere)).toBeNull()
    }
  })

  it('are never Alt with a letter, nor a held, composed or handled key', () => {
    for (const extra of [
      { altKey: true },
      { repeat: true },
      { isComposing: true },
      { defaultPrevented: true },
    ]) {
      expect(resolveKey(key('s', extra), nowhere)).toBeNull()
    }
  })

  it('are never Cmd or Ctrl with a letter', () => {
    for (const letter of ['c', 's', 'a', 'l', 'p', 'e']) {
      expect(resolveKey(key(letter, { metaKey: true }), nowhere)).toBeNull()
      expect(resolveKey(key(letter, { ctrlKey: true }), nowhere)).toBeNull()
    }
  })

  it('stay out of text fields, pickers, dialogs and editors', () => {
    for (const own of [
      'input',
      'textarea',
      'select',
      'dialog',
      '[popover]',
      '[role="listbox"]',
      '[role="combobox"]',
      '[role="textbox"]',
      '[role="alertdialog"]',
      '[role="menu"]',
    ]) {
      expect(resolveKey(key('s'), inside(own))).toBeNull()
      expect(keepsLetters(inside(own))).toBe(true)
    }
    expect(keepsLetters(nowhere)).toBe(false)
    expect(keepsLetters(null)).toBe(false)
  })
})

describe('Cmd+K', () => {
  it('opens the palette with Cmd, or Ctrl off the Mac, in either case', () => {
    expect(resolveKey(key('k', { metaKey: true }), nowhere)).toBe('palette')
    expect(resolveKey(key('K', { metaKey: true }), nowhere)).toBe('palette')
    expect(resolveKey(key('k', { ctrlKey: true }), nowhere)).toBe('palette')
  })

  it('opens from a text field, which it does not edit', () => {
    expect(resolveKey(key('k', { metaKey: true }), inside('input'))).toBe('palette')
    expect(resolveKey(key('k', { metaKey: true }), inside('textarea'))).toBe('palette')
  })

  it('does not open over a dialog or an open picker', () => {
    expect(resolveKey(key('k', { metaKey: true }), inside('dialog'))).toBeNull()
    expect(resolveKey(key('k', { metaKey: true }), inside('[popover]'))).toBeNull()
  })

  it('needs Cmd alone: not Shift or Alt with it, not held down, not handled', () => {
    for (const extra of [
      { shiftKey: true },
      { altKey: true },
      { repeat: true },
      { isComposing: true },
      { defaultPrevented: true },
    ]) {
      expect(resolveKey(key('k', { metaKey: true, ...extra }), nowhere)).toBeNull()
    }
  })

  it('is not plain K, which belongs to the Tree', () => {
    expect(resolveKey(key('k'), nowhere)).toBeNull()
  })
})

describe('Cmd+Z', () => {
  it('undoes with Cmd, or Ctrl off the Mac', () => {
    expect(resolveKey(key('z', { metaKey: true }), nowhere)).toBe('undo')
    expect(resolveKey(key('Z', { ctrlKey: true }), nowhere)).toBe('undo')
  })

  it('leaves native undo to a text field, an editor, a picker and a dialog', () => {
    for (const own of [
      'input',
      'textarea',
      '[contenteditable]:not([contenteditable="false"])',
      '[role="textbox"]',
      '[role="combobox"]',
      '[popover]',
      'dialog',
    ]) {
      expect(resolveKey(key('z', { metaKey: true }), inside(own))).toBeNull()
    }
  })

  it('is not Shift+Cmd+Z, which is redo and is not offered', () => {
    expect(resolveKey(key('z', { metaKey: true, shiftKey: true }), nowhere)).toBeNull()
  })

  it('is not plain Z, nor a held or handled key', () => {
    expect(resolveKey(key('z'), nowhere)).toBeNull()
    expect(resolveKey(key('z', { metaKey: true, repeat: true }), nowhere)).toBeNull()
    expect(resolveKey(key('z', { metaKey: true, defaultPrevented: true }), nowhere)).toBeNull()
  })
})

describe('Esc', () => {
  it('is ours when focus is on a button, the Tree or the page', () => {
    expect(resolveKey(key('Escape'), nowhere)).toBe('escape')
  })

  it('stays with a field, a picker or a dialog, which close or cancel themselves', () => {
    for (const own of ['input', 'textarea', '[popover]', 'dialog', '[role="combobox"]']) {
      expect(resolveKey(key('Escape'), inside(own))).toBeNull()
    }
  })

  it('skips an Esc the Tree or the page already handled', () => {
    expect(resolveKey(key('Escape', { defaultPrevented: true }), nowhere)).toBeNull()
  })

  it('is not Esc with a modifier', () => {
    expect(resolveKey(key('Escape', { metaKey: true }), nowhere)).toBeNull()
    expect(resolveKey(key('Escape', { altKey: true }), nowhere)).toBeNull()
  })
})
