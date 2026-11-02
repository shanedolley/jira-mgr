import { describe, expect, it } from 'vitest'

import {
  describeDate,
  formatDay,
  formatDayTime,
  parseDateInput,
  parseDateTimeInput,
} from './dates.js'

/** Monday 2 November 2026. */
const MONDAY = '2026-11-02'

describe('parseDateInput', () => {
  it.each([
    ['next tuesday', '2026-11-10'],
    ['3 weeks', '2026-11-23'],
    ['today', '2026-11-02'],
    ['tomorrow', '2026-11-03'],
    ['10/11/2026', '2026-11-10'],
    ['2099-01-01', '2099-01-01'],
    ['  tomorrow  ', '2026-11-03'],
  ])('reads %s on Monday 2 November 2026 as %s', (text, day) => {
    expect(parseDateInput(text, MONDAY)).toBe(day)
  })

  it.each([
    ['tuesday', '2026-11-03'],
    ['monday', '2026-11-09'],
    ['Mon', '2026-11-09'],
    ['sunday', '2026-11-08'],
    ['next monday', '2026-11-09'],
    ['last tuesday', '2026-10-27'],
    ['in 2 days', '2026-11-04'],
    ['2 days', '2026-11-04'],
    ['1 month', '2026-12-02'],
    ['10 nov', '2026-11-10'],
    ['nov 10', '2026-11-10'],
    ['31/12/2026', '2026-12-31'],
  ])('reads %s as %s', (text, day) => {
    expect(parseDateInput(text, MONDAY)).toBe(day)
  })

  it('rolls over a month end', () => {
    const end = '2026-10-30'
    expect(parseDateInput('3 days', end)).toBe('2026-11-02')
    expect(parseDateInput('next tuesday', end)).toBe('2026-11-03')
  })

  it('rolls over a year end', () => {
    const end = '2026-12-30'
    expect(parseDateInput('tomorrow', end)).toBe('2026-12-31')
    expect(parseDateInput('3 days', end)).toBe('2027-01-02')
    expect(parseDateInput('2 weeks', end)).toBe('2027-01-13')
    expect(parseDateInput('1 month', end)).toBe('2027-01-30')
  })

  it.each([
    ['1 month', '2027-01-31', '2027-02-28'],
    ['1 month', '2028-01-31', '2028-02-29'],
    ['in 2 months', '2026-12-31', '2027-02-28'],
    ['3 months', '2026-01-31', '2026-04-30'],
    ['next month', '2026-10-31', '2026-11-30'],
    ['1 month ago', '2026-03-31', '2026-02-28'],
    ['1 year', '2028-02-29', '2029-02-28'],
    ['2 years', '2028-02-29', '2030-02-28'],
    ['1 month', '2026-11-30', '2026-12-30'],
    ['1 month from now', '2027-01-31', '2027-02-28'],
    ['in 1 month 3 days', '2027-01-31', '2027-03-03'],
    ['in 1 month 1 week', '2027-01-31', '2027-03-07'],
    ['last year', '2028-02-29', '2027-02-28'],
    ['1 year ago', '2028-02-29', '2027-02-28'],
    ['in a month and a week', '2026-01-22', '2026-03-01'],
    ['in a month and a week', '2027-01-31', '2027-03-07'],
    ['a month and a week ago', '2026-01-08', '2025-12-01'],
    ['in a month a day', '2026-01-22', '2026-02-23'],
    ['in a month a day', '2027-01-31', '2027-03-01'],
    ['in 2 months and a day', '2026-01-22', '2026-03-23'],
    ['in 2 months and a day', '2026-12-31', '2027-03-01'],
    ['in a year and a day', '2026-01-22', '2027-01-23'],
    ['in a year and a day', '2028-02-29', '2029-03-01'],
    ['in 1 year and 1 month', '2028-02-29', '2029-03-29'],
    ['in 1 month a week', '2026-01-22', '2026-03-01'],
  ])('stops %s from %s at the end of a shorter month: %s', (text, today, day) => {
    expect(parseDateInput(text, today)).toBe(day)
  })

  it.each([
    ['fri.', '2026-11-06'],
    ['Fri', '2026-11-06'],
    ['tues', '2026-11-03'],
    ['weds', '2026-11-04'],
    ['thurs', '2026-11-05'],
  ])('reads the weekday %s as the next one, %s', (text, day) => {
    expect(parseDateInput(text, MONDAY)).toBe(day)
  })

  it.each([
    ['mon.', '2026-11-09'],
    ['wed.', '2026-11-04'],
    ['tue.', '2026-11-03'],
  ])('reads the abbreviated weekday %s as %s', (text, day) => {
    expect(parseDateInput(text, MONDAY)).toBe(day)
  })

  it('reads a month name with a stop as the month', () => {
    expect(parseDateInput('march.', MONDAY)).toBe(parseDateInput('march', MONDAY))
  })

  it('leaves a day of a month phrase alone', () => {
    expect(parseDateInput('5th of next month', '2027-01-31')).not.toBe('2027-02-28')
  })

  // Chrono maps a two-digit or 00xx year itself. Pinned so an upgrade cannot change it silently.
  it('reads the year of 10/11/0050 as 2050 and of 1/1/99 as 1999', () => {
    expect(parseDateInput('10/11/0050', MONDAY)).toBe('2050-11-10')
    expect(parseDateInput('1/1/99', MONDAY)).toBe('1999-01-01')
  })

  it.each([
    ['3 weeks', '2026-11-23'],
    ['in 3 days', '2026-11-05'],
    ['2 weeks ago', '2026-10-19'],
    ['next week', '2026-11-09'],
    ['last week', '2026-10-26'],
    ['next month', '2026-12-02'],
    ['last month', '2026-10-02'],
    ['tomorrow', '2026-11-03'],
    ['next tuesday', '2026-11-10'],
  ])('keeps %s from Monday 2 November 2026 at %s', (text, day) => {
    expect(parseDateInput(text, MONDAY)).toBe(day)
  })

  it('reads no span that mixes next or last with another', () => {
    expect(parseDateInput('next month and last week', MONDAY)).toBeNull()
    expect(parseDateInput('99999999999 years', MONDAY)).toBeNull()
  })

  it('reads the day of a leap year', () => {
    expect(parseDateInput('29/02/2028', MONDAY)).toBe('2028-02-29')
    expect(parseDateInput('29/02/2027', MONDAY)).toBeNull()
  })

  it.each(['', '   ', 'asdf', 'next', '30/02/2026', 'tomorrow and then some', '10/11/2026abc'])(
    'does not read %j',
    (text) => {
      expect(parseDateInput(text, MONDAY)).toBeNull()
    },
  )

  it('reads nothing against a reference that is not a day', () => {
    expect(parseDateInput('tomorrow', 'today')).toBeNull()
    expect(parseDateInput('tomorrow', '2026-02-30')).toBeNull()
  })

  it('does not read a phrase over the length limit', () => {
    expect(parseDateInput(`tomorrow${' '.repeat(200)}x`, MONDAY)).toBeNull()
  })
})

describe('describeDate', () => {
  it.each([
    ['2026-11-10', 'Tue 10 Nov 2026'],
    ['2026-11-02', 'Mon 2 Nov 2026'],
    ['2028-02-29', 'Tue 29 Feb 2028'],
  ])('writes %s as %s', (day, text) => {
    expect(describeDate(day)).toBe(text)
  })
})

describe('formatDay', () => {
  it.each([
    ['2026-11-10', '10 Nov'],
    ['2026-01-01', '1 Jan'],
    ['2027-11-10', '10 Nov 2027'],
    ['2025-12-31', '31 Dec 2025'],
    ['2026-02-28', '28 Feb'],
  ])('writes %s as %s on Monday 2 November 2026', (day, text) => {
    expect(formatDay(day, MONDAY)).toBe(text)
  })

  it('leaves a text that is not a day as it was', () => {
    expect(formatDay('soon', MONDAY)).toBe('soon')
    expect(formatDay('2026-13-40', MONDAY)).toBe('2026-13-40')
  })

  it('reads back as the same day, from every reference day of two years', () => {
    // Every day of 2026 and 2027 as the reference, and each target day in 2025 to 2029.
    const targets = [
      '2025-12-31',
      '2026-01-01',
      '2026-02-28',
      '2026-11-10',
      '2027-11-10',
      '2028-02-29',
      '2029-03-01',
    ]
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2028, 0, 1); t += 86_400_000 * 7) {
      const today = new Date(t).toISOString().slice(0, 10)
      for (const day of targets) {
        expect(parseDateInput(formatDay(day, today), today)).toBe(day)
      }
    }
  })

  it('reads a short date in the reference year, even when that day has passed', () => {
    expect(parseDateInput('10 Nov', MONDAY)).toBe('2026-11-10')
    expect(parseDateInput('1 Jan', MONDAY)).toBe('2026-01-01')
    expect(parseDateInput('10 Nov', '2027-03-01')).toBe('2027-11-10')
    expect(parseDateInput('10 Nov 2027', MONDAY)).toBe('2027-11-10')
  })
})

describe('parseDateTimeInput', () => {
  const now = MONDAY

  it.each([
    ['yesterday 2pm', '2026-11-01', '14:00'],
    ['today 9:30', '2026-11-02', '09:30'],
    ['next tuesday 10am', '2026-11-10', '10:00'],
    ['tomorrow at 7:05 pm', '2026-11-03', '19:05'],
    ['tuesday 14:30', '2026-11-03', '14:30'],
    ['monday 8am', '2026-11-09', '08:00'],
    ['in 3 days 12am', '2026-11-05', '00:00'],
    ['3 weeks, 4pm', '2026-11-23', '16:00'],
    ['10 Nov 2027 noon', '2027-11-10', '12:00'],
    ['2pm', '2026-11-02', '14:00'],
    ['9:30', '2026-11-02', '09:30'],
  ])('reads %s as %s at %s', (text, day, time) => {
    expect(parseDateTimeInput(text, now)).toEqual({ day, time })
  })

  it('gives a phrase with no time the time already in the field', () => {
    expect(parseDateTimeInput('yesterday', now, '15:45')).toEqual({
      day: '2026-11-01',
      time: '15:45',
    })
    expect(parseDateTimeInput('yesterday', now)).toEqual({ day: '2026-11-01', time: null })
    expect(parseDateTimeInput('yesterday', now, 'late')).toEqual({ day: '2026-11-01', time: null })
  })

  it('lets a time in the phrase replace the one in the field', () => {
    expect(parseDateTimeInput('yesterday 2pm', now, '15:45')).toEqual({
      day: '2026-11-01',
      time: '14:00',
    })
  })

  it.each(['whenever 2pm', 'yesterday 25:00', 'yesterday 2pm tomorrow', '', '   '])(
    'does not read %j',
    (text) => {
      expect(parseDateTimeInput(text, now)).toBeNull()
    },
  )

  it('reads what formatDayTime writes, as the same day and time', () => {
    for (const day of ['2026-11-10', '2027-11-10', '2025-01-01', '2028-02-29']) {
      for (const time of ['00:00', '09:05', '12:00', '23:59']) {
        const text = formatDayTime({ day, time }, '2026-11-02')
        expect(parseDateTimeInput(text, now)).toEqual({ day, time })
      }
    }
    expect(formatDayTime({ day: '2026-11-10', time: '14:30' }, '2026-11-02')).toBe('10 Nov, 14:30')
    expect(formatDayTime({ day: '2027-11-10', time: '14:30' }, '2026-11-02')).toBe(
      '10 Nov 2027, 14:30',
    )
    expect(formatDayTime({ day: '2026-11-10', time: null }, '2026-11-02')).toBe('10 Nov')
  })

  it('reads the time as local time and the day from the local date', () => {
    // 00:30 local on 2 November is still 1 November in UTC for a zone ahead of it, and the other way round.
    expect(parseDateTimeInput('today 1am', MONDAY)).toEqual({ day: '2026-11-02', time: '01:00' })
    expect(parseDateTimeInput('tomorrow 11pm', MONDAY)).toEqual({
      day: '2026-11-03',
      time: '23:00',
    })
  })
})
