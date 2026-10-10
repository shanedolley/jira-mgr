import { describe, expect, it } from 'vitest'

import { attachFiles, type AttachDeps } from './attach'

/** A deps stand-in that records what happened in order. */
function recorder(send?: AttachDeps['send']) {
  const events: string[] = []
  const deps: AttachDeps = {
    send:
      send ??
      ((file) => {
        events.push(`send ${file.filename} ${file.mimeType} ${String(file.bytes.length)}`)
        return Promise.resolve()
      }),
    start: (name) => events.push(`start ${name}`),
    finish: (name) => events.push(`finish ${name}`),
    fail: (notice, name) =>
      events.push(`fail ${notice.title}: ${notice.notes.join(' ')} (${name})`),
  }
  return { deps, events }
}

describe('attachFiles', () => {
  it('sends the files one at a time, in order, with the type the browser gave', async () => {
    const { deps, events } = recorder()
    await attachFiles(
      [
        new File(['abc'], 'a.zip', { type: 'application/zip' }),
        new File(['de'], 'b.bin', { type: '' }),
      ],
      deps,
    )
    expect(events).toEqual([
      'start a.zip',
      'send a.zip application/zip 3',
      'finish a.zip',
      'start b.bin',
      'send b.bin  2',
      'finish b.bin',
    ])
  })

  it('reports a failure and still sends the next file', async () => {
    let calls = 0
    const { deps, events } = recorder(() => {
      calls++
      return calls === 1 ? Promise.reject(new Error('Jira said no.')) : Promise.resolve()
    })
    await attachFiles([new File(['a'], 'a.txt'), new File(['b'], 'b.txt')], deps)
    expect(events).toEqual([
      'start a.txt',
      'fail a.txt was not attached: Jira said no. (a.txt)',
      'finish a.txt',
      'start b.txt',
      'finish b.txt',
    ])
  })

  it('refuses an empty file, and one over 100 MB before reading it', async () => {
    const { deps, events } = recorder()
    const big = new File(['x'], 'big.iso')
    Object.defineProperty(big, 'size', { value: 100_000_001 })
    let read = false
    big.arrayBuffer = () => {
      read = true
      return Promise.resolve(new ArrayBuffer(0))
    }
    await attachFiles([new File([], 'empty.txt'), big], deps)
    expect(events).toEqual([
      'fail empty.txt was not attached: The file is empty. (empty.txt)',
      'fail big.iso was not attached: It is over the 100 MB limit. (big.iso)',
    ])
    expect(read).toBe(false)
  })

  it('reports a file that cannot be read, such as a dropped folder', async () => {
    const { deps, events } = recorder()
    const folder = new File(['x'], 'folder')
    folder.arrayBuffer = () => Promise.reject(new Error('The requested file could not be read.'))
    await attachFiles([folder], deps)
    expect(events).toEqual([
      'start folder',
      'fail folder was not attached: The requested file could not be read. (folder)',
      'finish folder',
    ])
  })
})
