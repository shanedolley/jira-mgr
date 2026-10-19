import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  SHORTCUT_TABLES,
  filterShortcuts,
  parseShortcuts,
  shortcutCells,
  splitMarks,
} from './shortcuts'

/** The sections of the page, in order. A change to them is a change to the dialog's layout. */
const SECTION_TITLES = [
  'Move around the Tree',
  'Select and reorder',
  'Edit an issue',
  'Create and track time',
  'Click on a row',
  'Find, filter and views',
  'Menus and pickers',
  'Dialogs and fields',
  'App and pages',
]
/** Every row of the page. A story that adds or removes a shortcut changes this one number. */
const SHORTCUT_COUNT = 81

const DOC = new URL('../../../../../docs/reference/shortcuts.md', import.meta.url)

describe('parseShortcuts', () => {
  it('reads each table under its heading and skips the prose and the rule line', () => {
    const tables = parseShortcuts(
      [
        '# Page',
        'Intro.',
        '',
        '## One',
        'Words.',
        '| A | B |',
        '|---|:--|',
        '| `x` | y |',
        '',
        '## None',
        'Only prose.',
      ].join('\n'),
    )
    expect(tables).toEqual([{ title: 'One', columns: ['A', 'B'], rows: [['`x`', 'y']] }])
  })
})

describe('the shortcuts page the overlay lists', () => {
  const lines = readFileSync(DOC, 'utf8').split('\n')

  it('gives the overlay every table and every row of docs/reference/shortcuts.md', () => {
    const rows = lines.filter((line) => line.startsWith('|') && !/^\|[\s:|-]+\|?$/.test(line))
    const headers = lines.filter(
      (line, at) => line.startsWith('|') && !lines[at - 1]?.startsWith('|'),
    )
    expect(SHORTCUT_TABLES.map((t) => t.title)).toEqual(SECTION_TITLES)
    expect(new Set(SECTION_TITLES).size).toBe(SECTION_TITLES.length)
    expect(SHORTCUT_TABLES.reduce((n, t) => n + t.rows.length, 0)).toBe(
      rows.length - headers.length,
    )
    expect(rows.length - headers.length).toBe(SHORTCUT_COUNT)
    for (const table of SHORTCUT_TABLES) {
      for (const row of table.rows) expect(row).toHaveLength(table.columns.length)
    }
  })

  it('lists every row once', () => {
    const rows = SHORTCUT_TABLES.flatMap((t) => t.rows.map((row) => `${t.title}|${row.join('|')}`))
    const keyAndAction = SHORTCUT_TABLES.flatMap((t) =>
      t.rows.map((row) => {
        const { keys, action, where } = shortcutCells(t, row)
        return `${where}|${keys}|${action}`
      }),
    )
    expect(new Set(rows).size).toBe(rows.length)
    expect(new Set(keyAndAction).size).toBe(keyAndAction.length)
  })

  it('lists the ? key that opens it', () => {
    const app = SHORTCUT_TABLES.find((t) => t.title === 'App and pages')
    expect(app?.rows.map((row) => shortcutCells(app, row).keys)).toContain('`?`')
  })
})

describe('filterShortcuts', () => {
  const titles = (query: string) => filterShortcuts(SHORTCUT_TABLES, query).map((t) => t.title)
  const keysOf = (query: string) =>
    filterShortcuts(SHORTCUT_TABLES, query).flatMap((t) =>
      t.rows.map((row) => shortcutCells(t, row).keys),
    )
  const rowsOf = (query: string) => filterShortcuts(SHORTCUT_TABLES, query).flatMap((t) => t.rows)

  it('keeps every section and row for an empty or blank query', () => {
    expect(titles('')).toEqual(SECTION_TITLES)
    expect(titles('   ')).toEqual(SECTION_TITLES)
    expect(rowsOf('')).toHaveLength(SHORTCUT_COUNT)
  })

  it('needs every word, in any case, and drops the sections left empty', () => {
    const hits = filterShortcuts(SHORTCUT_TABLES, 'SHIFT')
    expect(hits.length).toBeLessThan(SECTION_TITLES.length)
    for (const hit of hits) {
      expect(hit.total).toBe(SHORTCUT_TABLES.find((t) => t.title === hit.title)?.rows.length)
      for (const row of hit.rows) expect(row.join(' ').toLowerCase()).toContain('shift')
    }
    expect(rowsOf('shift zzz')).toHaveLength(0)
    expect(rowsOf('log work modal enter')).toHaveLength(1)
  })

  it('treats cmd, ⌘ and ctrl as one key, and ↵ as enter', () => {
    expect(rowsOf('cmd').length).toBeGreaterThan(0)
    expect(rowsOf('⌘')).toEqual(rowsOf('cmd'))
    expect(rowsOf('ctrl')).toEqual(rowsOf('cmd'))
    expect(rowsOf('↵')).toEqual(rowsOf('enter'))
    expect(rowsOf('⇧')).toEqual(rowsOf('shift'))
  })

  it('finds a chord by what its keycap shows, or with or without the plus', () => {
    const cmdK = rowsOf('cmd+k')
    expect(cmdK.length).toBeGreaterThan(0)
    expect(keysOf('cmd+k')).toContain('`Cmd+K`')
    for (const query of ['⌘k', '⌘K', 'ctrl+k']) expect(rowsOf(query), query).toEqual(cmdK)
    // Two words each match anywhere in a row, so these find the chord among others.
    for (const query of ['cmd k', '⌘ k']) expect(keysOf(query), query).toContain('`Cmd+K`')
    expect(keysOf('⌘z')).toContain('`Cmd+Z`')
    expect(keysOf('⇧s')).toContain('`Shift+S`')
    expect(rowsOf('+')).toHaveLength(SHORTCUT_COUNT)
  })

  it('matches escape to Esc', () => {
    expect(rowsOf('escape').length).toBeGreaterThan(0)
    expect(rowsOf('escape')).toEqual(rowsOf('esc'))
  })

  it('reads a key without its backticks', () => {
    expect(rowsOf('shift+s').length).toBeGreaterThan(0)
    expect(rowsOf('`')).toHaveLength(0)
  })

  it('shows the whole section when its title holds the words', () => {
    const [pickers] = filterShortcuts(SHORTCUT_TABLES, 'pickers')
    expect(pickers?.title).toBe('Menus and pickers')
    expect(pickers?.rows).toHaveLength(pickers?.total ?? -1)
  })
})

describe('splitMarks', () => {
  it('flags the runs that hold a word, in any case', () => {
    expect(splitMarks('Open the Shift menu', 'shift')).toEqual([
      { text: 'Open the ', hit: false },
      { text: 'Shift', hit: true },
      { text: ' menu', hit: false },
    ])
    expect(splitMarks('a b a', 'a b').map((r) => r.hit)).toEqual([true, false, true, false, true])
  })

  it('returns the text whole for no query, and takes regex characters literally', () => {
    expect(splitMarks('plain', '')).toEqual([{ text: 'plain', hit: false }])
    expect(splitMarks('a (b) c', '(b')).toEqual([
      { text: 'a ', hit: false },
      { text: '(b', hit: true },
      { text: ') c', hit: false },
    ])
  })

  it('marks the longest word first, so a short word does not split a longer one', () => {
    expect(splitMarks('Shift s', 's shift')).toEqual([
      { text: 'Shift', hit: true },
      { text: ' ', hit: false },
      { text: 's', hit: true },
    ])
  })

  it('marks every spelling of an aliased key', () => {
    expect(splitMarks('Cmd+Z, Ctrl and ⌘', 'cmd').filter((r) => r.hit)).toHaveLength(3)
  })
})
