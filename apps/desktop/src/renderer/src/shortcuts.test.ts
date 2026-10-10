import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { SHORTCUT_TABLES, parseShortcuts } from './shortcuts'

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
    expect(SHORTCUT_TABLES.map((t) => t.title)).toEqual(['Global', 'Tree', 'Fields and Dialogs'])
    expect(SHORTCUT_TABLES.reduce((n, t) => n + t.rows.length, 0)).toBe(
      rows.length - headers.length,
    )
    for (const table of SHORTCUT_TABLES) {
      for (const row of table.rows) expect(row).toHaveLength(table.columns.length)
    }
  })

  it('lists the ? key that opens it', () => {
    const global = SHORTCUT_TABLES.find((t) => t.title === 'Global')
    expect(global?.rows.map((row) => row[0])).toContain('`?`')
  })
})
