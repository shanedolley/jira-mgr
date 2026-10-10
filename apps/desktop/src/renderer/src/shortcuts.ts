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
