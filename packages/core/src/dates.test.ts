import { describe, expect, it } from 'vitest'

import { describeDate, parseDateInput } from './dates.js'

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
