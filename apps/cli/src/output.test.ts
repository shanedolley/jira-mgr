import { describe, expect, it } from 'vitest'

import { colourOn, paint, renderTable, stripControl, truncate, ttyOf, type Tty } from './output.js'
import { fakeIo } from './test-io.js'

const plain = (columns: number): Tty => ({ columns, style: (_, text) => text })

describe('output', () => {
  it('tables pad columns and truncate the summary to the width', () => {
    const columns = [{ header: 'KEY' }, { header: 'ASSIGNEE', max: 10 }, { header: 'SUMMARY' }]
    const rows = [
      [
        'PSAPAC-12',
        'Shane Dolley and friends',
        'Build the loader for the very long migration plan',
      ],
      ['PSAPAC-3', 'Me', 'Short'],
    ]
    expect(renderTable(plain(40), columns, rows).split('\n')).toEqual([
      'KEY        ASSIGNEE    SUMMARY',
      'PSAPAC-12  Shane Dol…  Build the loader fo…',
      'PSAPAC-3   Me          Short',
    ])
  })

  it('tables keep at least 20 characters for the last column and style the header', () => {
    const rows = [['PSAPAC-12', 'x'.repeat(60)]]
    const [, line] = renderTable(plain(5), [{ header: 'KEY' }, { header: 'SUMMARY' }], rows).split(
      '\n',
    )
    expect(line).toBe(`PSAPAC-12  ${'x'.repeat(19)}…`)
    const bold: Tty = { columns: 80, style: (format, text) => `<${String(format)}>${text}` }
    expect(renderTable(bold, [{ header: 'KEY' }], [['a']]).split('\n')[0]).toBe('<bold>KEY')
  })

  it('no colour without a TTY or with NO_COLOR', () => {
    const red = '\u001b[31mx\u001b[39m'
    expect(paint(fakeIo().io, false, 'red', 'x')).toBe('x')
    expect(paint(fakeIo().io, true, 'red', 'x')).toBe(red)
    expect(paint(fakeIo({ env: { NO_COLOR: '1' } }).io, true, 'red', 'x')).toBe('x')
    expect(paint(fakeIo({ env: { FORCE_COLOR: '1' } }).io, false, 'red', 'x')).toBe(red)
    expect(paint(fakeIo({ env: { FORCE_COLOR: '0' } }).io, true, 'red', 'x')).toBe('x')
    expect(colourOn({ NO_COLOR: '1', FORCE_COLOR: '1' }, true)).toBe(false)
    const tty = ttyOf(fakeIo({ stdoutIsTTY: true, columns: 60 }).io)
    expect(tty.columns).toBe(60)
    expect(tty.style('bold', 'x')).toBe('\u001b[1mx\u001b[22m')
    expect(ttyOf(fakeIo().io).columns).toBe(100)
  })

  it('control characters are stripped on a TTY', () => {
    expect(stripControl('a\u001b[31mb\u0007c\u009bd\u0000e\u007f')).toBe('a[31mbcde')
    expect(stripControl('keep\ttabs\nand newlines')).toBe('keep\ttabs\nand newlines')
    const table = renderTable(
      plain(80),
      [{ header: 'KEY' }, { header: 'SUMMARY' }],
      [['P-1', 'bad\u001b]0;title\u0007 text']],
    )
    expect(table.replaceAll('\n', '')).not.toMatch(/\p{Cc}/u)
    expect(table).toContain('bad]0;title text')
  })

  it('truncate ends in an ellipsis within the limit', () => {
    expect(truncate('abcdef', 4)).toBe('abc…')
    expect(truncate('abcd', 4)).toBe('abcd')
  })
})
