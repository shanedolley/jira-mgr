import { InvalidArgumentError } from 'commander'
import { describe, expect, it } from 'vitest'

import { parserFor, parseValue } from './values.js'

const refuses = (type: Parameters<typeof parseValue>[0], raw: string) => {
  expect(() => parseValue(type, raw), `${type} ${raw}`).toThrow(InvalidArgumentError)
}

describe('values', () => {
  it('issue keys normalise to upper case and refuse PSAPAC-0', () => {
    expect(parseValue('issue-key', 'psapac-12')).toBe('PSAPAC-12')
    expect(parseValue('issue-key', 'PSAPAC-12')).toBe('PSAPAC-12')
    for (const bad of ['PSAPAC-0', 'PSAPAC', '12', 'PSAPAC-01', 'PSAPAC-1.5', '-12'])
      refuses('issue-key', bad)
  })

  it('durations accept 1h30m and print 1h 30m, and refuse 1.5h', () => {
    expect(parseValue('duration', '1h30m')).toBe('1h 30m')
    expect(parseValue('duration', '1h 30m')).toBe('1h 30m')
    expect(parseValue('duration', '90m')).toBe('90m')
    expect(parseValue('duration', '1w 2d')).toBe('1w 2d')
    expect(parseValue('duration', '30m1h')).toBe('1h 30m')
    for (const bad of ['1.5h', 'abc', '', '1h1h', '1h x', '1x', '30']) refuses('duration', bad)
  })

  it('datetimes read an offset, Z and local time', () => {
    const before = process.env.TZ
    try {
      process.env.TZ = 'Asia/Tokyo'
      const iso = (raw: string) => (parseValue('datetime', raw) as Date).toISOString()
      expect(iso('2026-10-07T10:30:00+10:00')).toBe('2026-10-07T00:30:00.000Z')
      expect(iso('2026-10-07T10:30:00Z')).toBe('2026-10-07T10:30:00.000Z')
      expect(iso('2026-10-07 10:30')).toBe('2026-10-07T01:30:00.000Z')
      expect(iso('2026-10-07T10:30')).toBe('2026-10-07T01:30:00.000Z')
      process.env.TZ = 'America/New_York'
      expect(iso('2026-10-07 10:30')).toBe('2026-10-07T14:30:00.000Z')
      for (const bad of [
        '2026-10-07',
        '10:30',
        '2026-10-07 25:00',
        '2026-13-07 10:30',
        '2026-02-30T10:00Z',
        '2026-10-07T24:00:00Z',
        '2026-10-07T10:60:00Z',
        'now',
      ]) {
        refuses('datetime', bad)
      }
    } finally {
      if (before === undefined) delete process.env.TZ
      else process.env.TZ = before
    }
  })

  it('dates refuse anything but YYYY-MM-DD', () => {
    expect(parseValue('date', '2026-10-07')).toBe('2026-10-07')
    for (const bad of [
      '2026-02-30',
      '07/10/2026',
      '2026-1-7',
      '2026-10-07T00:00',
      '20261007',
      'tomorrow',
    ]) {
      refuses('date', bad)
    }
  })

  it('enums match in any case and return the schema spelling', () => {
    const choices = ['Epic', 'Story']
    expect(parseValue('enum', 'story', choices)).toBe('Story')
    expect(parseValue('enum', 'EPIC', choices)).toBe('Epic')
    expect(() => parseValue('enum', 'bug', choices)).toThrow(/Epic, Story/)
  })

  it('clearable values turn none into null', () => {
    const due = parserFor({ name: 'due', type: 'date', description: '', clearable: true })
    expect(due('none')).toBeNull()
    expect(due('NONE')).toBeNull()
    expect(due('2026-10-07')).toBe('2026-10-07')
    const plain = parserFor({ name: 'due', type: 'date', description: '' })
    expect(() => plain('none')).toThrow(InvalidArgumentError)
  })

  it('repeatable values collect, numbers parse and integers refuse zero', () => {
    const label = parserFor({ name: 'label', type: 'text', description: '', repeatable: true })
    expect(label('b', label('a'))).toEqual(['a', 'b'])
    expect(parseValue('number', '0')).toBe(0)
    expect(parseValue('number', '1.5')).toBe(1.5)
    expect(parseValue('integer', '20')).toBe(20)
    for (const bad of ['0', '-1', '1.5', 'x']) refuses('integer', bad)
    for (const bad of ['-1', '.5', 'x']) refuses('number', bad)
    refuses('id', 'abc')
    refuses('text', '')
  })
})
