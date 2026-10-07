import { styleText } from 'node:util'

import type { ErrorCode } from '@jira-mgr/core'

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
  const line = (row: readonly string[]) =>
    row
      .map((cell, i) =>
        i === last
          ? truncate(cell, lastWidth)
          : truncate(cell, widths[i] ?? 0).padEnd(widths[i] ?? 0),
      )
      .join(GAP)
  const header = columns.map((column, i) =>
    i === last ? column.header : column.header.padEnd(widths[i] ?? 0),
  )
  return [tty.style('bold', header.join(GAP)), ...cells.map(line)].join('\n')
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
