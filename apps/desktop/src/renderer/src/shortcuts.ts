import shortcutsDoc from '../../../../../docs/reference/shortcuts.md?raw'

/** One table of `docs/reference/shortcuts.md`: the `##` heading above it, its columns and its rows. */
export interface ShortcutTable {
  title: string
  columns: readonly string[]
  rows: readonly (readonly string[])[]
}

const cells = (line: string) =>
  line
    .slice(1, line.endsWith('|') ? -1 : undefined)
    .split('|')
    .map((cell) => cell.trim())

/**
 * The tables of a shortcuts page, each under its `##` heading. The overlay renders what this
 * returns for the real page, so the page is the one list of shortcuts and the overlay cannot
 * miss a row. Prose outside the tables is ignored.
 */
export function parseShortcuts(markdown: string): ShortcutTable[] {
  const tables: ShortcutTable[] = []
  let title = ''
  let table: { title: string; columns: string[]; rows: string[][] } | null = null
  for (const line of markdown.split('\n')) {
    if (line.startsWith('## ')) {
      title = line.slice(3).trim()
      table = null
    } else if (line.startsWith('|')) {
      if (table === null) {
        table = { title, columns: cells(line), rows: [] }
        tables.push(table)
      } else if (!/^\|[\s:|-]+\|?$/.test(line)) {
        table.rows.push(cells(line))
      }
    } else {
      table = null
    }
  }
  return tables
}

/** The tables the `?` overlay lists. */
export const SHORTCUT_TABLES = parseShortcuts(shortcutsDoc)

/** A row's cells by column name. A table without a Where column gives an empty `where`. */
export function shortcutCells(table: Pick<ShortcutTable, 'columns'>, row: readonly string[]) {
  const cell = (name: string) => row[table.columns.indexOf(name)] ?? ''
  return { where: cell('Where'), keys: cell('Key'), action: cell('Action') }
}

/** A table that survived a search, with the row count it had before. */
export interface ShortcutMatch extends ShortcutTable {
  total: number
}

// Words that name one key several ways: ⌘ and Ctrl stand in for Cmd, ↵ for Enter, ⇧ for Shift.
const ALIASES: readonly (readonly [string, string])[] = [
  ['⌘', 'cmd'],
  ['ctrl', 'cmd'],
  ['↵', 'enter'],
  ['⇧', 'shift'],
]
const ALTERNATES: Record<string, string> = {
  cmd: '(?:cmd|ctrl|⌘)',
  enter: '(?:enter|↵)',
  shift: '(?:shift|⇧)',
}

const canon = (text: string) =>
  ALIASES.reduce((t, [from, to]) => t.replaceAll(from, to), text.toLowerCase())

const words = (query: string) => canon(query).split(/\s+/).filter(Boolean)

/** The tables with only the rows that hold every word of `query`; a table whose title holds them all stays whole. */
export function filterShortcuts(tables: readonly ShortcutTable[], query: string): ShortcutMatch[] {
  const wanted = words(query)
  return tables
    .map((table) => {
      const rows = table.rows.filter((row) => {
        const text = canon(`${table.title} ${row.join(' ')}`.replaceAll('`', ''))
        return wanted.every((word) => text.includes(word))
      })
      return { ...table, rows, total: table.rows.length }
    })
    .filter((table) => table.rows.length > 0)
}

/** `text` cut into runs, those that hold a word of `query` flagged `hit`. Backticks are the caller's to strip. */
export function splitMarks(text: string, query: string): { text: string; hit: boolean }[] {
  const wanted = words(query).map((word) =>
    word
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/cmd|enter|shift/g, (name) => ALTERNATES[name] ?? name),
  )
  if (wanted.length === 0) return [{ text, hit: false }]
  return text
    .split(new RegExp(`(${wanted.join('|')})`, 'i'))
    .map((part, at) => ({ text: part, hit: at % 2 === 1 }))
    .filter((run) => run.text !== '')
}
