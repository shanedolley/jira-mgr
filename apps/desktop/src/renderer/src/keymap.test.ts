import { describe, expect, it } from 'vitest'

import { keepsLetters, keyOf, resolveKey, type KeyEvent, type KeyTarget } from './keymap'

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

/** A target that sits inside an element matching each of `selectors`, and no other. */
const inside = (...selectors: string[]): KeyTarget => ({
  closest: (list) => (list.split(', ').some((one) => selectors.includes(one)) ? {} : null),
})
const nowhere: KeyTarget = { closest: () => null }
/** The Tree, the Peek or the issue page, where a letter acts. */
const SCOPE = '[data-key-scope]'
const scoped = inside(SCOPE)

describe('the letter shortcuts', () => {
  it('map C, T, W, S, A, L, P, E, I, Y, U and F, and with Shift W, A, L, I, Y, U and F alike', () => {
    const expected = {
      c: 'create',
      t: 'timer',
      w: 'worklogs',
      s: 'status',
      a: 'assignee',
      l: 'labels',
      p: 'priority',
      e: 'edit',
      i: 'assignMe',
      y: 'copyKey',
      u: 'copyLink',
      f: 'filterMenu',
    }
    for (const [letter, command] of Object.entries(expected)) {
      expect(resolveKey(key(letter), scoped)).toBe(command)
      // A Caps Lock letter arrives uppercase with no Shift.
      expect(resolveKey(key(letter.toUpperCase()), scoped)).toBe(command)
      if ('cpest'.includes(letter)) continue
      expect(resolveKey(key(letter.toUpperCase(), { shiftKey: true }), scoped)).toBe(command)
    }
  })

  it('map Shift+S, Shift+D, Shift+P, Shift+E, Shift+C and Shift+T to start date, due date, parent, estimate, sprint and Log work, never to S, D, P, E, C or T', () => {
    const expected = {
      s: 'startDate',
      d: 'dueDate',
      p: 'parent',
      e: 'estimate',
      c: 'sprint',
      t: 'logWork',
    }
    for (const [letter, command] of Object.entries(expected)) {
      expect(resolveKey(key(letter.toUpperCase(), { shiftKey: true }), scoped)).toBe(command)
      expect(resolveKey(key(letter.toLowerCase(), { shiftKey: true }), scoped)).toBe(command)
    }
    // D alone is not a shortcut.
    expect(resolveKey(key('d'), scoped)).toBeNull()
  })

  it('give Shift+S, Shift+D, Shift+P, Shift+E and Shift+C the same guards as the letters', () => {
    for (const letter of ['S', 'D', 'P', 'E', 'C']) {
      const shifted = (extra: Partial<KeyEvent> = {}) => key(letter, { shiftKey: true, ...extra })
      expect(resolveKey(shifted(), nowhere)).toBeNull()
      expect(resolveKey(shifted(), inside(SCOPE, 'input'))).toBeNull()
      expect(resolveKey(shifted(), inside(SCOPE, '[role="menu"]'))).toBeNull()
      expect(resolveKey(shifted({ metaKey: true }), scoped)).toBeNull()
      expect(resolveKey(shifted({ altKey: true }), scoped)).toBeNull()
      expect(resolveKey(shifted({ repeat: true }), scoped)).toBeNull()
    }
  })

  it('leave every other key to the control that has it', () => {
    for (const other of ['x', 'j', 'k', ' ', 'Enter', 'ArrowDown', 'constructor']) {
      expect(resolveKey(key(other), scoped)).toBeNull()
    }
  })

  it('are never Alt with a letter, nor a held, composed or handled key', () => {
    for (const extra of [
      { altKey: true },
      { repeat: true },
      { isComposing: true },
      { defaultPrevented: true },
    ]) {
      expect(resolveKey(key('s', extra), scoped)).toBeNull()
    }
  })

  it('are never Cmd or Ctrl with a letter', () => {
    for (const letter of ['c', 't', 'w', 's', 'a', 'l', 'p', 'e', 'i', 'y', 'u', 'f']) {
      expect(resolveKey(key(letter, { metaKey: true }), scoped)).toBeNull()
      expect(resolveKey(key(letter, { ctrlKey: true }), scoped)).toBeNull()
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
      expect(resolveKey(key('s'), inside(SCOPE, own))).toBeNull()
      expect(keepsLetters(inside(SCOPE, own))).toBe(true)
    }
    expect(keepsLetters(scoped)).toBe(false)
    expect(keepsLetters(null)).toBe(false)
  })

  it('act only inside the Tree, the Peek or the issue page', () => {
    for (const letter of ['c', 't', 'w', 's', 'a', 'l', 'p', 'e', 'i', 'y', 'u', 'f']) {
      expect(resolveKey(key(letter), scoped)).not.toBeNull()
      expect(resolveKey(key(letter), nowhere)).toBeNull()
      expect(resolveKey(key(letter), null)).toBeNull()
    }
  })

  it('do nothing on a sidebar or toolbar button', () => {
    // `closest` finds a button's own ancestors, none of which is a scope.
    const button = inside('button', 'nav', 'section')
    expect(resolveKey(key('t'), button)).toBeNull()
    expect(resolveKey(key('c'), button)).toBeNull()
  })
})

describe('the peek and open keys', () => {
  it('map O to the Peek and Shift+O to the issue page, in either case', () => {
    expect(resolveKey(key('o'), scoped)).toBe('peek')
    // A Caps Lock letter arrives uppercase with no Shift.
    expect(resolveKey(key('O'), scoped)).toBe('peek')
    expect(resolveKey(key('O', { shiftKey: true }), scoped)).toBe('openPage')
    expect(resolveKey(key('o', { shiftKey: true }), scoped)).toBe('openPage')
  })

  it('give O and Shift+O the same guards as the letters', () => {
    for (const shiftKey of [false, true]) {
      const press = (extra: Partial<KeyEvent> = {}) => key('o', { shiftKey, ...extra })
      expect(resolveKey(press(), nowhere)).toBeNull()
      expect(resolveKey(press(), null)).toBeNull()
      for (const own of ['input', 'textarea', 'dialog', '[popover]', '[role="listbox"]']) {
        expect(resolveKey(press(), inside(SCOPE, own))).toBeNull()
      }
      for (const extra of [
        { metaKey: true },
        { ctrlKey: true },
        { altKey: true },
        { repeat: true },
        { isComposing: true },
        { defaultPrevented: true },
      ]) {
        expect(resolveKey(press(extra), scoped)).toBeNull()
      }
    }
  })
})

describe('the filter key', () => {
  it('answers to / from anywhere that is not a field, picker or dialog', () => {
    expect(resolveKey(key('/'), scoped)).toBe('filter')
    expect(resolveKey(key('/'), nowhere)).toBe('filter')
    expect(resolveKey(key('/'), null)).toBe('filter')
  })

  it('stays out of text fields, pickers, dialogs and editors', () => {
    for (const own of ['input', 'textarea', 'dialog', '[popover]', '[role="combobox"]']) {
      expect(resolveKey(key('/'), inside(own))).toBeNull()
    }
  })

  it('is never / with Cmd, Ctrl or Alt, nor a held, composed or handled key', () => {
    for (const extra of [
      { metaKey: true },
      { ctrlKey: true },
      { altKey: true },
      { repeat: true },
      { isComposing: true },
      { defaultPrevented: true },
    ]) {
      expect(resolveKey(key('/', extra), scoped)).toBeNull()
    }
  })
})

describe('the menu key', () => {
  it('answers to Shift+F10 from anywhere that is not a field, picker or dialog', () => {
    for (const target of [scoped, nowhere, null]) {
      expect(resolveKey(key('F10', { shiftKey: true }), target)).toBe('menu')
    }
    expect(resolveKey(key('F10'), scoped)).toBeNull()
  })

  it('stays out of text fields, pickers and menus, and out of Cmd, Ctrl and Alt', () => {
    for (const own of ['input', 'textarea', 'dialog', '[popover]', '[role="menu"]']) {
      expect(resolveKey(key('F10', { shiftKey: true }), inside(own))).toBeNull()
    }
    for (const extra of [
      { metaKey: true },
      { ctrlKey: true },
      { altKey: true },
      { repeat: true },
    ]) {
      expect(resolveKey(key('F10', { shiftKey: true, ...extra }), scoped)).toBeNull()
    }
  })
})

describe('the help key', () => {
  it('answers to ? with Shift from anywhere that is not a field, picker or dialog', () => {
    for (const target of [scoped, nowhere, null]) {
      expect(resolveKey(key('?', { shiftKey: true }), target)).toBe('help')
    }
  })

  it('stays out of text fields, pickers, dialogs and editors', () => {
    for (const own of ['input', 'textarea', 'dialog', '[popover]', '[role="combobox"]']) {
      expect(resolveKey(key('?', { shiftKey: true }), inside(own))).toBeNull()
    }
  })

  it('is never ? with Cmd, Ctrl or Alt, nor a held, composed or handled key', () => {
    for (const extra of [
      { metaKey: true },
      { ctrlKey: true },
      { altKey: true },
      { repeat: true },
      { isComposing: true },
      { defaultPrevented: true },
    ]) {
      expect(resolveKey(key('?', { shiftKey: true, ...extra }), scoped)).toBeNull()
    }
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

describe('keyOf', () => {
  it('names the keycap of each command that has a letter, and nothing for the rest', () => {
    expect(keyOf('status')).toBe('S')
    expect(keyOf('assignee')).toBe('A')
    expect(keyOf('assignMe')).toBe('I')
    expect(keyOf('copyKey')).toBe('Y')
    expect(keyOf('copyLink')).toBe('U')
    expect(keyOf('filterMenu')).toBe('F')
    expect(keyOf('timer')).toBe('T')
    expect(keyOf('worklogs')).toBe('W')
    expect(keyOf('logWork')).toBe('Shift+T')
    expect(keyOf('startDate')).toBe('Shift+S')
    expect(keyOf('dueDate')).toBe('Shift+D')
    expect(keyOf('parent')).toBe('Shift+P')
    expect(keyOf('estimate')).toBe('Shift+E')
    expect(keyOf('sprint')).toBe('Shift+C')
    expect(keyOf('peek')).toBe('O')
    expect(keyOf('openPage')).toBe('Shift+O')
    expect(keyOf('openInJira')).toBeUndefined()
  })
})
