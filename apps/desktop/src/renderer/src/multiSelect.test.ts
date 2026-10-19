import { describe, expect, it } from 'vitest'

import {
  checkAll,
  extendBy,
  NO_SELECTION,
  prune,
  rangeTo,
  togglesCheck,
  type Selection,
} from './multiSelect'
import { clearSelection, toggleChecked } from './tree'

/** The Sprint page's rows in page order: To Do, then In Progress, then Done. */
const ORDER = ['S-1', 'S-2', 'S-3', 'S-4', 'S-5', 'S-6']
const sel = (keys: string[], anchor: string | null): Selection => ({
  checked: new Set(keys),
  anchor,
})
const sorted = (selection: Selection) => [...selection.checked].sort()

describe('togglesCheck', () => {
  const click = (keys: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey', boolean>>) => ({
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    ...keys,
  })

  it('is Cmd on macOS, where Ctrl+click is the context menu', () => {
    expect(togglesCheck(click({ metaKey: true }), true)).toBe(true)
    expect(togglesCheck(click({ ctrlKey: true }), true)).toBe(false)
  })

  it('is Ctrl off macOS', () => {
    expect(togglesCheck(click({ ctrlKey: true }), false)).toBe(true)
    expect(togglesCheck(click({ metaKey: true }), false)).toBe(false)
  })

  it('is neither for a plain click', () => {
    expect(togglesCheck(click({}), true)).toBe(false)
    expect(togglesCheck(click({}), false)).toBe(false)
  })
})

describe('toggle', () => {
  it('checks and unchecks one key, which becomes the anchor, keeping the others', () => {
    const on = toggleChecked(sel(['S-1'], 'S-1'), 'S-4')
    expect(sorted(on)).toEqual(['S-1', 'S-4'])
    expect(on.anchor).toBe('S-4')
    const off = toggleChecked(on, 'S-1')
    expect(sorted(off)).toEqual(['S-4'])
    expect(off.anchor).toBe('S-1')
  })
})

describe('rangeTo', () => {
  it('adds every key from the anchor to the clicked one, in either direction, unchecking none', () => {
    const down = rangeTo(ORDER, sel(['S-1', 'S-6'], 'S-2'), 'S-4', null)
    expect(sorted(down)).toEqual(['S-1', 'S-2', 'S-3', 'S-4', 'S-6'])
    expect(down.anchor).toBe('S-2')
    const up = rangeTo(ORDER, sel(['S-5'], 'S-5'), 'S-3', null)
    expect(sorted(up)).toEqual(['S-3', 'S-4', 'S-5'])
  })

  it('crosses the status sections, since the order runs through all of them', () => {
    expect(sorted(rangeTo(ORDER, sel(['S-2'], 'S-2'), 'S-5', null))).toEqual([
      'S-2',
      'S-3',
      'S-4',
      'S-5',
    ])
  })

  it('starts from the active row with no anchor, else from the clicked row itself', () => {
    const fromActive = rangeTo(ORDER, NO_SELECTION, 'S-4', 'S-2')
    expect(sorted(fromActive)).toEqual(['S-2', 'S-3', 'S-4'])
    expect(fromActive.anchor).toBe('S-2')
    const alone = rangeTo(ORDER, NO_SELECTION, 'S-4', null)
    expect(sorted(alone)).toEqual(['S-4'])
    expect(alone.anchor).toBe('S-4')
  })

  it('combines with a toggle: check A, toggle C, range to E checks A, C and C to E', () => {
    const a = toggleChecked(NO_SELECTION, 'S-1')
    const c = toggleChecked(a, 'S-3')
    const e = rangeTo(ORDER, c, 'S-5', 'S-5')
    expect(sorted(e)).toEqual(['S-1', 'S-3', 'S-4', 'S-5'])
    expect(e.anchor).toBe('S-3')
  })

  it('checks nothing for a key the page does not list', () => {
    expect(sorted(rangeTo(ORDER, sel(['S-1'], 'S-1'), 'S-99', null))).toEqual(['S-1'])
  })
})

describe('checkAll and clear', () => {
  it('Cmd+A adds every key in page order and anchors on the first', () => {
    const all = checkAll(ORDER, NO_SELECTION)
    expect(sorted(all)).toEqual(ORDER)
    expect(all.anchor).toBe('S-1')
    expect(checkAll(ORDER, sel(['S-3'], 'S-3')).anchor).toBe('S-3')
  })

  it('Esc empties the set and drops the anchor', () => {
    expect(clearSelection(sel(['S-1', 'S-2'], 'S-2'))).toEqual(NO_SELECTION)
  })
})

describe('extendBy', () => {
  it('moves the active row one step and checks the rows it crosses, anchored where it began', () => {
    const down = extendBy(ORDER, NO_SELECTION, 'S-2', 1)
    expect(down?.active).toBe('S-3')
    expect(sorted(down?.selection ?? NO_SELECTION)).toEqual(['S-2', 'S-3'])
    expect(down?.selection.anchor).toBe('S-2')
    const up = extendBy(ORDER, sel(['S-2', 'S-3'], 'S-2'), 'S-3', -1)
    expect(up?.active).toBe('S-2')
    expect(sorted(up?.selection ?? NO_SELECTION)).toEqual(['S-2', 'S-3'])
  })

  it('stops at the ends', () => {
    expect(extendBy(ORDER, NO_SELECTION, 'S-6', 1)?.active).toBe('S-6')
    expect(extendBy(ORDER, NO_SELECTION, 'S-1', -1)?.active).toBe('S-1')
  })

  it('does nothing with no active row or one the page does not list', () => {
    expect(extendBy(ORDER, NO_SELECTION, null, 1)).toBeNull()
    expect(extendBy(ORDER, NO_SELECTION, 'S-99', 1)).toBeNull()
  })
})

describe('prune', () => {
  it('drops the keys and the anchor the page no longer lists', () => {
    const left = prune(['S-1', 'S-2'], sel(['S-1', 'S-3'], 'S-3'))
    expect(sorted(left)).toEqual(['S-1'])
    expect(left.anchor).toBeNull()
  })

  it('returns the same object when nothing needs dropping', () => {
    const held = sel(['S-1'], 'S-1')
    expect(prune(ORDER, held)).toBe(held)
    expect(prune([], NO_SELECTION)).toBe(NO_SELECTION)
  })
})
