import * as chrono from 'chrono-node'
import { z } from 'zod'

import { dayKey } from './view-filter.js'

const Text = z.string().trim().min(1).max(100)
const Day = z.iso.date()

const WEEKDAY_ONLY = /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*$/i
/** `nov 10`, which chrono reads as November 2010. */
const MONTH_THEN_DAY = /^([a-z]{3,9})\.?\s+(\d{1,2})$/i
/** `3 weeks`, which chrono reads only after `in`. */
const BARE_SPAN = /^(\d+|an?)\s*(day|week|month|year)s?$/i
/** A phrase made only of spans, such as `in 1 month 3 days` or `1 year from now`. */
const SPANS =
  /^(?:in\s+)?(?:(?:\d+|an?|next|last)\s*(?:day|week|month|year)s?\s*(?:and\s+)?)+(?:ago|from now)?$/i
const MONTH_UNIT = /\b(?:month|year)s?\b/i
const DAY_UNITS = /(\d+)\s*(day|week)s?/gi

/** The days the day and week units of a span add, negative for `ago`. */
function spanDays(phrase: string): number {
  let days = 0
  for (const [, count = '0', unit = ''] of phrase.matchAll(DAY_UNITS)) {
    days += Number(count) * (unit.toLowerCase() === 'week' ? 7 : 1)
  }
  return /\bago\b/i.test(phrase) ? -days : days
}

/**
 * The day a typed phrase names, as `YYYY-MM-DD`, or `null` when it is not a date. `today` is the
 * reference day, `YYYY-MM-DD`. Day comes before month (`10/11/2026` is 10 November), `next
 * tuesday` is the Tuesday of next week, a bare weekday is the next one after today, and `3 weeks`
 * is today plus 21 days. A span of months or years stops at the end of a shorter month: `1 month`
 * from 31 January is 28 February. The whole phrase must read as one date.
 */
export function parseDateInput(text: string, today: string): string | null {
  const input = Text.safeParse(text)
  const reference = Day.safeParse(today)
  if (!input.success || !reference.success) return null
  const phrase = input.data
    .replace(/^(tue|wed)s?\.?$/i, '$1')
    .replace(/^([a-z]{3,9})\.$/i, '$1')
    .replace(MONTH_THEN_DAY, '$2 $1')
    .replace(BARE_SPAN, 'in $1 $2')
  const weekday = WEEKDAY_ONLY.test(phrase)
  // Noon, so a daylight-saving shift never moves the day.
  const [y = 0, m = 1, d = 1] = reference.data.split('-').map(Number)
  const instant = new Date(y, m - 1, d, 12)
  const found = chrono.en.GB.parse(phrase, instant, { forwardDate: weekday })[0]
  if (found?.index !== 0 || found.text.length !== phrase.length) return null
  const { start } = found
  const year = start.get('year') ?? 0
  if (year < 1000) return null
  const picked = new Date(year, (start.get('month') ?? 1) - 1, start.get('day') ?? 0, 12)
  if (SPANS.test(phrase) && MONTH_UNIT.test(phrase)) {
    // `1 month` from 31 January runs past February: it means the last day of February, and the
    // days after the month span (`1 month 3 days`) count from there.
    const extra = spanDays(phrase)
    const span = new Date(picked)
    span.setDate(span.getDate() - extra)
    if (span.getDate() < d) {
      span.setDate(0)
      span.setDate(span.getDate() + extra)
      picked.setTime(span.getTime())
    }
  }
  // Chrono answers today for `monday` on a Monday, where the next Monday is meant.
  if (weekday && dayKey(picked) === dayKey(instant)) {
    picked.setDate(picked.getDate() + 7)
  }
  const day = Day.safeParse(dayKey(picked))
  return day.success ? day.data : null
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A day as the date fields preview it, whatever the system locale: `Tue 10 Nov 2026`. */
export function describeDate(day: string): string {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? ''
  return `${weekday} ${String(d)} ${MONTHS[m - 1] ?? ''} ${String(y)}`
}
