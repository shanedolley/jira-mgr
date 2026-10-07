import { InvalidArgumentError } from 'commander'
import { z } from 'zod'

import type { ArgSpec, OptionSpec, ValueType } from './schema.js'

/** A string schema that runs `read`, which returns `undefined` for a value it refuses. */
const reads = <T>(read: (text: string) => T | undefined) =>
  z.string().transform((text, ctx) => {
    const value = read(text)
    if (value === undefined) {
      ctx.issues.push({ code: 'custom', message: 'Invalid value.', input: text })
      return z.NEVER
    }
    return value
  })

const OFFSET_DATETIME =
  /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/

/** True for a real `YYYY-MM-DD` day. Date rolls 2026-02-30 into March, so compare the text back. */
function isDay(text: string): boolean {
  const day = new Date(`${text}T00:00:00Z`)
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(text) &&
    !Number.isNaN(day.getTime()) &&
    day.toISOString().startsWith(text)
  )
}
const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/

const DURATION_UNITS = ['w', 'd', 'h', 'm'] as const

/** `1h30m` or `1h 30m` to `1h 30m`, with units in w, d, h, m order and none repeated. */
function readDuration(text: string): string | undefined {
  const parts = [...text.matchAll(/(\d+)\s*([wdhm])/g)]
  if (
    parts.length === 0 ||
    parts
      .map((p) => p[0])
      .join('')
      .replaceAll(/\s/g, '') !== text.replaceAll(/\s/g, '')
  ) {
    return undefined
  }
  const byUnit = new Map(parts.map((p) => [p[2], p[1]]))
  if (byUnit.size !== parts.length) return undefined
  return DURATION_UNITS.filter((u) => byUnit.has(u))
    .map((u) => `${byUnit.get(u) ?? ''}${u}`)
    .join(' ')
}

interface ValueRule {
  schema: z.ZodType
  /** Shown after "is invalid." */
  hint: string
}

const RULES: Record<Exclude<ValueType, 'enum' | 'boolean'>, ValueRule> = {
  text: { schema: z.string().min(1), hint: 'Give a non-empty value.' },
  markdown: { schema: z.string().min(1), hint: 'Give a non-empty value.' },
  file: { schema: z.string().min(1), hint: 'Give a file path, or - for stdin.' },
  'issue-key': {
    schema: z
      .string()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9_]*-[1-9]\d*$/),
    hint: 'Give an issue key such as PSAPAC-12.',
  },
  id: { schema: z.string().regex(/^\d+$/), hint: 'Give an id made of digits.' },
  date: {
    schema: reads((text) => (isDay(text) ? text : undefined)),
    hint: 'Use YYYY-MM-DD.',
  },
  datetime: {
    schema: reads((text) => {
      const offset = OFFSET_DATETIME.exec(text)
      if (offset) {
        const date = new Date(text)
        return isDay(offset[1] ?? '') && !Number.isNaN(date.getTime()) ? date : undefined
      }
      const m = LOCAL_DATETIME.exec(text)
      if (!m) return undefined
      const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number]
      const date = new Date(y, mo - 1, d, h, mi)
      // Rejects a field that rolled over, such as 25:00, or a local time the zone skips.
      const same = date.getMonth() === mo - 1 && date.getDate() === d && date.getHours() === h
      return same ? date : undefined
    }),
    hint: 'Use an ISO 8601 time with an offset or Z, or YYYY-MM-DD HH:mm in local time.',
  },
  duration: {
    schema: reads(readDuration),
    hint: 'Use whole w, d, h and m units, such as 1h30m. Decimals are not accepted.',
  },
  number: {
    schema: reads((text) => (/^\d+(?:\.\d+)?$/.test(text) ? Number(text) : undefined)),
    hint: 'Give a number of 0 or more.',
  },
  integer: {
    schema: reads((text) => (/^[1-9]\d*$/.test(text) ? Number(text) : undefined)),
    hint: 'Give a whole number of 1 or more.',
  },
}

/** Parses one raw value of a type. Throws Commander's `InvalidArgumentError` (exit 2) on a bad one. */
export function parseValue(type: ValueType, raw: string, choices: readonly string[] = []): unknown {
  if (type === 'boolean') return true
  if (type === 'enum') {
    const choice = choices.find((c) => c.toLowerCase() === raw.toLowerCase())
    if (choice === undefined)
      throw new InvalidArgumentError(`Allowed choices are ${choices.join(', ')}.`)
    return choice
  }
  const rule = RULES[type]
  const result = rule.schema.safeParse(raw)
  if (!result.success) throw new InvalidArgumentError(rule.hint)
  return result.data
}

/**
 * The Commander parser for one argument or option. A clearable value turns `none` into null, and a
 * repeatable or variadic one appends to the values so far.
 */
export function parserFor(
  spec: ArgSpec | OptionSpec,
): (value: string, previous?: unknown) => unknown {
  const flags: { repeatable?: boolean; variadic?: boolean; clearable?: boolean } = spec
  const many = flags.repeatable === true || flags.variadic === true
  const clearable = flags.clearable === true
  return (value, previous) => {
    const parsed =
      clearable && value.toLowerCase() === 'none'
        ? null
        : parseValue(spec.type, value, spec.choices)
    return many ? [...(Array.isArray(previous) ? (previous as unknown[]) : []), parsed] : parsed
  }
}
