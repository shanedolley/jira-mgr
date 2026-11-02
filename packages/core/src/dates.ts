import * as chrono from 'chrono-node'
import { z } from 'zod'

import { dayKey } from './view-filter.js'

const Text = z.string().trim().min(1).max(100)
const Day = z.iso.date()
const Time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)

const WEEKDAY_ONLY = /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*$/i
const MONTH =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const ORDINAL = '(?:st|nd|rd|th)?'
/** `nov 10` and `nov 10th`, which chrono reads as November 2010. */
const MONTH_THEN_DAY = new RegExp(`^(${MONTH})\\.?\\s+(\\d{1,2})${ORDINAL}$`, 'i')
/** `10 nov`, `10th nov` and `10th of nov`, which chrono reads as the nearest 10 November, not the one in the reference year. */
const DAY_THEN_MONTH = new RegExp(`^(\\d{1,2})${ORDINAL}\\s*(?:of\\s+)?(${MONTH})\\.?$`, 'i')

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
  const plain = input.data.replace(/^(tue|wed)s?\.?$/i, '$1').replace(/^([a-z]{3,9})\.$/i, '$1')
  // A month and day with no year is in the reference year, so `formatDay` reads back as itself.
  const pinned = plain
    .replace(MONTH_THEN_DAY, `$2 $1 ${reference.data.slice(0, 4)}`)
    .replace(DAY_THEN_MONTH, `$1 $2 ${reference.data.slice(0, 4)}`)
  // 29 February has no day in a year that is not a leap year, so the phrase falls back to
  // chrono's own year, the nearest one it can read.
  const swapped = plain.replace(MONTH_THEN_DAY, '$2 $1').replace(DAY_THEN_MONTH, '$1 $2')
  return (
    readPhrase(pinned, reference.data) ??
    (pinned === plain ? null : readPhrase(swapped, reference.data))
  )
}

/** The day `phrase` names against the reference day, or `null`. */
function readPhrase(phrase: string, today: string): string | null {
  const weekday = WEEKDAY_ONLY.test(phrase)
  const [y = 0, m = 1, d = 1] = today.split('-').map(Number)
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

/**
 * A day as the date fields hold it once they have read it: `10 Nov` in the year of `today` and
 * `10 Nov 2027` in any other. `parseDateInput` reads it back as the same day. `day` and `today` are
 * `YYYY-MM-DD`; a `day` that is not one comes back as it was.
 */
export function formatDay(day: string, today: string): string {
  const parsed = Day.safeParse(day)
  if (!parsed.success) return day
  const [y = 0, m = 1, d = 1] = parsed.data.split('-').map(Number)
  const short = `${String(d)} ${MONTHS[m - 1] ?? ''}`
  return today.startsWith(`${String(y).padStart(4, '0')}-`) ? short : `${short} ${String(y)}`
}

/** A day and the time of day on it, `HH:mm` in local time, or `null` for a day with no time. */
export interface DayTime {
  day: string
  time: string | null
}

/** A day and time as the Started field holds them: `10 Nov, 14:30`, or `10 Nov 2027, 14:30`. */
export function formatDayTime({ day, time }: DayTime, today: string): string {
  return time === null ? formatDay(day, today) : `${formatDay(day, today)}, ${time}`
}

/** `2pm`, `9:30`, `14:30`, `at 10am`, `noon`: a time of day. */
const CLOCK =
  '(?:at\\s+)?(?:\\d{1,2}(?:[:.]\\d{2})?\\s*[ap]\\.?m\\.?|\\d{1,2}:\\d{2}|noon|midnight)'
/** A time that ends a phrase, after a space or a comma: `yesterday 2pm`. */
const TRAILING_TIME = new RegExp(`^(?:(.+?)(?:\\s*,\\s*|\\s+))?(${CLOCK})$`, 'i')
/** A time that starts a phrase: `5pm yesterday`, `14:30 10 nov`, `noon on friday`. */
const LEADING_TIME = new RegExp(`^(${CLOCK})(?:\\s*,\\s*|\\s+)(?:on\\s+)?(.+)$`, 'i')
/** A time anywhere in a phrase, which is left over when the day part of a phrase still holds one. */
const ANY_TIME = new RegExp(`(?<![\\w:.])${CLOCK}(?![a-z])`, 'i')

/**
 * The day and time a typed phrase names, for a field that holds both, such as a work log's
 * Started: `yesterday 2pm`, `today 9:30`, `next tuesday 10am`, `5pm yesterday`, `10 Nov, 14:30`.
 * The day follows `parseDateInput` and the time is chrono's, in local time. A phrase with no
 * time takes `keepTime` (`HH:mm` or `null`), the time the field already holds. A phrase that is
 * only a time, such as `2pm`, is that time on `keepDay`, the day the field already holds, or
 * today. `today` is the reference day, `YYYY-MM-DD`. A phrase with two times is not read.
 */
export function parseDateTimeInput(
  text: string,
  today: string,
  keepTime: string | null = null,
  keepDay: string | null = null,
): DayTime | null {
  const input = Text.safeParse(text)
  const reference = Day.safeParse(today)
  if (!input.success || !reference.success) return null
  const kept = Time.safeParse(keepTime)
  const keptDay = Day.safeParse(keepDay)
  const fallback = kept.success ? kept.data : null
  const split = TRAILING_TIME.exec(input.data) ?? LEADING_TIME.exec(input.data)
  if (split === null) {
    if (ANY_TIME.test(input.data)) return null
    const day = parseDateInput(input.data, reference.data)
    return day === null ? null : { day, time: fallback }
  }
  // The time is the last group when it ends the phrase, and the first when it starts it.
  const trailing = TRAILING_TIME.test(input.data)
  const datePart = trailing ? split[1] : split[2]
  const timePart = (trailing ? split[2] : split[1]) ?? ''
  if (datePart !== undefined && ANY_TIME.test(datePart)) return null
  const day =
    datePart === undefined
      ? keptDay.success
        ? keptDay.data
        : reference.data
      : parseDateInput(datePart, reference.data)
  const [y = 0, m = 1, d = 1] = reference.data.split('-').map(Number)
  const found = chrono.en.GB.parse(timePart, new Date(y, m - 1, d, 12))[0]
  if (day === null || found?.index !== 0 || found.text.length !== timePart.length) return null
  if (!found.start.isCertain('hour')) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  const time = Time.safeParse(
    `${pad(found.start.get('hour') ?? 0)}:${pad(found.start.get('minute') ?? 0)}`,
  )
  return time.success ? { day, time: time.data } : null
}
