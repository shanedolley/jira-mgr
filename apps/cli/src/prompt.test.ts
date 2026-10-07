import { PassThrough, Writable } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import { ask } from './prompt.js'

/** A terminal that types `keys` and records what the prompt writes back. */
function terminal(keys: string) {
  const input = new PassThrough()
  const shown: string[] = []
  const output = new Writable({
    write(chunk: Buffer, _encoding, done) {
      shown.push(chunk.toString())
      done()
    },
  })
  const typed = () => input.write(keys)
  return { input, output, typed, shown: () => shown.join('') }
}

describe('ask', () => {
  it('echoes a visible answer', async () => {
    const t = terminal('PSAPAC\r')
    const answer = ask(t.input, t.output, 'Project: ', false, vi.fn())
    t.typed()
    expect(await answer).toBe('PSAPAC')
    expect(t.shown()).toContain('Project: ')
    expect(t.shown()).toContain('PSAPAC')
  })

  it('never echoes a hidden answer', async () => {
    const secret = 'ATATT3xFfGF0-secret_token=ABC123'
    const t = terminal(`${secret}\r`)
    const answer = ask(t.input, t.output, 'Token: ', true, vi.fn())
    t.typed()
    expect(await answer).toBe(secret)
    expect(t.shown()).toBe('Token: \n')
  })

  it('Ctrl-C ends the line, visible prompt or hidden', async () => {
    for (const hidden of [false, true]) {
      const t = terminal('\u0003')
      const answer = ask(t.input, t.output, 'Q: ', hidden, vi.fn())
      t.typed()
      expect(await answer).toBe('')
      expect(t.shown().endsWith('\n'), String(hidden)).toBe(true)
      expect(t.shown().match(/\n/g)).toHaveLength(1)
    }
  })

  it('Ctrl-C calls onInterrupt and gives no answer', async () => {
    const t = terminal('abc\u0003')
    const onInterrupt = vi.fn()
    const answer = ask(t.input, t.output, 'Token: ', true, onInterrupt)
    t.typed()
    expect(await answer).toBe('')
    expect(onInterrupt).toHaveBeenCalledOnce()
  })

  it('Ctrl-D gives an empty answer', async () => {
    const t = terminal('\u0004')
    const answer = ask(t.input, t.output, 'Token: ', true, vi.fn())
    t.typed()
    expect(await answer).toBe('')
  })
})
