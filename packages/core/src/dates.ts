import * as chrono from 'chrono-node'
import { z } from 'zod'

import { dayKey } from './view-filter.js'

const Text = z.string().trim().min(1).max(100)
const Day = z.iso.date()

const WEEKDAY_ONLY = /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*$/i
/** `nov 10`, which chrono reads as November 2010. */
const MONTH_THEN_DAY = /^([a-z]{3,9})\.?\s+(\d{1,2})$/i
/** A phrase made only of spans, such as `3 weeks`, `in a month and a week` or `1 year ago`. */
const SPANS =
  /^(?:in\s+)?(?:(?:\d+|an?|next|last)\s*(?:day|week|month|year)s?\s*(?:and\s+)?)+(?:ago|from now)?$/i
const SPAN = /(\d+|an?|next|last)\s*(day|week|month|year)s?/gi

/**
 * The day a span phrase names, counted here because chrono's month arithmetic overflows: months
 * and years go first, in one step that stops at the end of a shorter month (`1 month` from 31
 * January is 28 February), then weeks and days. `ago` and `last` count backwards.
 */
function spanDay(phrase: string, y: number, m: number, d: number): Date | null {
  const spans = [...phrase.matchAll(SPAN)]
  let months = 0
  let days = 0
  let sign = /\bago\b/i.test(phrase) ? -1 : 1
  for (const [, word = '', unit = ''] of spans) {
    const count = /^\d/.test(word) ? Number(word) : 1
    const relative = /^(?:next|last)$/i.test(word)
    if (relative && spans.length > 1) return null
    if (/^last$/i.test(word)) sign = -1
    switch (unit.toLowerCase()) {
      case 'year':
        months += 12 * count
        break
      case 'month':
        months += count
        break
      case 'week':
        days += 7 * count
        break
      default:
        days += count
    }
  }
  const at = y * 12 + (m - 1) + sign * months
  const year = Math.floor(at / 12)
  const month = at - year * 12
  const last = new Date(year, month + 1, 0).getDate()
  const picked = new Date(year, month, Math.min(d, last), 12)
  picked.setDate(picked.getDate() + sign * days)
  return picked
}

/**
 * The day a typed phrase names, as `YYYY-MM-DD`, or `null` when it is not a date. `today` is the
 * reference day, `YYYY-MM-DD`. Day comes before month (`10/11/2026` is 10 November), `next
 * tuesday` is the Tuesday of next week, a bare weekday is the next one after today, and `3 weeks`
 * is today plus 21 days. A span of months or years stops at the end of a shorter month: `1 month`
 * from 31 January is 28 February (`spanDay`). The whole phrase must read as one date.
 */
export function parseDateInput(text: string, today: string): string | null {
  const input = Text.safeParse(text)
  const reference = Day.safeParse(today)
  if (!input.success || !reference.success) return null
  const phrase = input.data
    .replace(/^(tue|wed)s?\.?$/i, '$1')
    .replace(/^([a-z]{3,9})\.$/i, '$1')
    .replace(MONTH_THEN_DAY, '$2 $1')
  const weekday = WEEKDAY_ONLY.test(phrase)
  const [y = 0, m = 1, d = 1] = reference.data.split('-').map(Number)
  if (SPANS.test(phrase)) {
    const span = spanDay(phrase, y, m, d)
    const spanned = span === null ? null : Day.safeParse(dayKey(span))
    return spanned?.success === true ? spanned.data : null
  }
  // Noon, so a daylight-saving shift never moves the day.
  const instant = new Date(y, m - 1, d, 12)
  const found = chrono.en.GB.parse(phrase, instant, { forwardDate: weekday })[0]
  if (found?.index !== 0 || found.text.length !== phrase.length) return null
  const { start } = found
  const year = start.get('year') ?? 0
  if (year < 1000) return null
  const picked = new Date(year, (start.get('month') ?? 1) - 1, start.get('day') ?? 0, 12)
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
