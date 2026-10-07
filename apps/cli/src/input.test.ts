import { describe, expect, it } from 'vitest'

import { readUpTo } from './input.js'

/** A file handle that returns at most `step` bytes per read, as a pipe or a network file system may. */
function chunked(content: string, step: number) {
  const data = Buffer.from(content)
  const reads: number[] = []
  return {
    reads,
    handle: {
      read(buffer: Buffer, offset: number, length: number, position: number) {
        const bytesRead = Math.min(step, length, data.length - position)
        data.copy(buffer, offset, position, position + bytesRead)
        reads.push(bytesRead)
        return Promise.resolve({ bytesRead, buffer })
      },
    },
  }
}

describe('readUpTo', () => {
  it('keeps reading past short reads until the file ends', async () => {
    const { handle, reads } = chunked('hello world', 3)
    expect((await readUpTo(handle as never, 100)).toString()).toBe('hello world')
    expect(reads).toEqual([3, 3, 3, 2, 0])
  })

  it('stops at the limit and leaves the rest unread', async () => {
    const { handle } = chunked('abcdefghij', 4)
    expect((await readUpTo(handle as never, 6)).toString()).toBe('abcdef')
  })

  it('returns an empty buffer for an empty file', async () => {
    const { handle } = chunked('', 4)
    expect((await readUpTo(handle as never, 6)).length).toBe(0)
  })
})
