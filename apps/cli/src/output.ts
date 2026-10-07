import { styleText } from 'node:util'

import type { ErrorCode } from '@jira-mgr/core'
import type { CustomerGroup, HierarchyNode } from '@jira-mgr/core/hierarchy'

import type { Io } from './context.js'

type Format = Parameters<typeof styleText>[0]

/** What a handler's `render` knows about the terminal. */
export interface Tty {
  columns: number
  /** Wraps text in colour codes, or returns it unchanged when colour is off. */
  style(format: Format, text: string): string
}

const DEFAULT_COLUMNS = 100

/** Colour is on for a TTY, off under `NO_COLOR`, and on under `FORCE_COLOR` unless it is `0` or `false`. */
export function colourOn(env: Io['env'], isTTY: boolean): boolean {
  if (env.NO_COLOR) return false
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== '0' && env.FORCE_COLOR !== 'false'
  return isTTY
}

/** Styles `text` when colour is on for the stream behind `isTTY`. */
export function paint(io: Io, isTTY: boolean, format: Format, text: string): string {
  return colourOn(io.env, isTTY) ? styleText(format, text, { validateStream: false }) : text
}

export function ttyOf(io: Io): Tty {
  return {
    columns: io.columns ?? DEFAULT_COLUMNS,
    style: (format, text) => paint(io, io.stdoutIsTTY, format, text),
  }
}

/** Removes C0 and C1 control characters except newline and tab, so Jira text cannot drive the terminal. */
export function stripControl(text: string): string {
  return text.replaceAll(/(?![\n\t])\p{Cc}/gu, '')
}

/** Shortens `text` to `max` characters, ending in an ellipsis. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

export interface Column {
  header: string
  /** Truncates the column at this width. The last column takes the rest of the line instead. */
  max?: number
  /** Styles a cell after it is padded and truncated, so colour codes never count toward the width. */
  paint?: (cell: string, row: number) => string
}

const GAP = '  '
const MIN_LAST_WIDTH = 20

/**
 * Pads each column to its widest cell and joins them with two spaces under a bold header. The last
 * column is truncated to what remains of the terminal width, at least 20 characters.
 */
export function renderTable(
  tty: Tty,
  columns: readonly Column[],
  rows: readonly (readonly string[])[],
): string {
  const cells = rows.map((row) => row.map((cell) => stripControl(cell).replaceAll(/\s+/g, ' ')))
  const last = columns.length - 1
  const widths = columns.slice(0, last).map((column, i) => {
    const longest = Math.max(column.header.length, ...cells.map((row) => (row[i] ?? '').length))
    return Math.min(longest, column.max ?? longest)
  })
  const used = widths.reduce((sum, width) => sum + width + GAP.length, 0)
  const lastWidth = Math.max(MIN_LAST_WIDTH, tty.columns - used)
  const line = (row: readonly string[], r: number) =>
    row
      .map((cell, i) => {
        const fitted =
          i === last
            ? truncate(cell, lastWidth)
            : truncate(cell, widths[i] ?? 0).padEnd(widths[i] ?? 0)
        const paint = columns[i]?.paint
        if (paint === undefined) return fitted
        // Colour the text only, so the padding after it stays plain.
        const text = fitted.trimEnd()
        return paint(text, r) + fitted.slice(text.length)
      })
      .join(GAP)
  const header = columns.map((column, i) =>
    i === last ? column.header : column.header.padEnd(widths[i] ?? 0),
  )
  return [tty.style('bold', header.join(GAP)), ...cells.map(line)].join('\n')
}

/** Colours a status by its category: none for to do, blue for in progress, green for done. */
export function statusStyle(tty: Tty, category: string, text: string): string {
  if (category === 'indeterminate') return tty.style('blue', text)
  if (category === 'done') return tty.style('green', text)
  return text
}

/** `Label:  value` lines with the labels in bold and the values aligned. `paint` styles a value after it is cleaned. */
export function renderRecord(
  tty: Tty,
  rows: readonly (readonly [label: string, value: string, paint?: (value: string) => string])[],
): string {
  const width = Math.max(...rows.map(([label]) => label.length))
  return rows
    .map(([label, value, paint]) => {
      const text = stripControl(value)
      return `${tty.style('bold', `${label}:`)}${' '.repeat(width - label.length)} ${paint?.(text) ?? text}`
    })
    .join('\n')
}

/** An ISO time as local `YYYY-MM-DD HH:mm`, the form a terminal shows. */
export function localDateTime(iso: string): string {
  const date = new Date(iso)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${String(date.getFullYear())}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}

/** The failure envelope's `error` object. `details` is omitted when undefined. */
export interface ErrorBody {
  code: ErrorCode
  message: string
  details?: unknown
}

/** One JSON value and a newline: compact when piped, indented when `--json` runs on a terminal. */
export function toJson(value: unknown, pretty: boolean): string {
  return `${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`
}

export const dataEnvelope = (data: unknown) => ({ data: data === undefined ? null : data })
export const errorEnvelope = (error: ErrorBody) => ({ error })

const clean = (text: string) => stripControl(text).replaceAll(/\s+/g, ' ')
const TYPE_WIDTH = 7

/**
 * The Customer, Epic, issue, Subtask tree, two spaces per level. Type pads to 7 characters and
 * status to the longest shown. A mismatch gets a yellow badge and a `+N done` chip stands for the
 * Done children. A context-only row is dim, or ends in ` (context)` when colour is off.
 */
export function renderTree(tty: Tty, groups: readonly CustomerGroup[]): string {
  const everyNode = (node: HierarchyNode): HierarchyNode[] => [
    node,
    ...node.children.flatMap(everyNode),
  ]
  const shown = groups.flatMap((g) => [...g.epics, ...g.noEpic].flatMap(everyNode))
  const statusWidth = Math.max(0, ...shown.map((n) => clean(n.issue.status.name).length))
  const coloured = tty.style('dim', 'x') !== 'x'
  const indent = (depth: number) => '  '.repeat(depth)
  const lines: string[] = []

  function row(node: HierarchyNode, depth: number): string {
    const { issue, contextOnly, customerMismatch } = node
    const status = clean(issue.status.name)
    const head = `${indent(depth)}${issue.key}  ${clean(issue.issueType.name).padEnd(TYPE_WIDTH)}  `
    const badge =
      customerMismatch === null
        ? ''
        : `  [Customer: ${clean(customerMismatch.own?.value ?? 'No Customer')}, Epic: ${clean(customerMismatch.epic?.value ?? 'No Customer')}]`
    const room = Math.max(
      MIN_LAST_WIDTH,
      tty.columns - head.length - statusWidth - 2 - badge.length,
    )
    const summary = truncate(clean(issue.summary), room)
    const pad = ' '.repeat(statusWidth - status.length)
    if (contextOnly) {
      const text = `${head}${status}${pad}  ${summary}${badge}`
      return coloured ? tty.style('dim', text) : `${text} (context)`
    }
    return `${head}${statusStyle(tty, issue.status.category, status)}${pad}  ${summary}${badge === '' ? '' : tty.style('yellow', badge)}`
  }

  function walk(node: HierarchyNode, depth: number): void {
    lines.push(row(node, depth))
    for (const child of node.children) walk(child, depth + 1)
    if (node.doneCount > 0) lines.push(`${indent(depth + 1)}+${String(node.doneCount)} done`)
  }

  for (const group of groups) {
    lines.push(tty.style('bold', clean(group.customer?.value ?? 'No Customer')))
    for (const epic of group.epics) walk(epic, 1)
    if (group.noEpic.length > 0) {
      lines.push(`${indent(1)}No Epic`)
      for (const issue of group.noEpic) walk(issue, 2)
    }
  }
  return lines.join('\n')
}
