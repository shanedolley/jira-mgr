import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { failure } from '../test/msw.js'
import {
  INBOX_DAYS,
  isUnread,
  markAllRead,
  markRead,
  pruned,
  readInbox,
  readMark,
  withAllRead,
  withRead,
  type InboxState,
} from './inbox.js'

const NOW = new Date('2026-10-11T00:00:00.000Z')
const NEVER = '1970-01-01T00:00:00.000Z'

const inbox = (allReadAt: string, reads: Record<string, string> = {}): InboxState => ({
  version: 1,
  allReadAt,
  reads,
})

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jm-inbox-'))
  process.env.JM_STATE_DIR = dir
})

afterEach(async () => {
  delete process.env.JM_STATE_DIR
  await rm(dir, { recursive: true, force: true })
})

describe('inbox.json', () => {
  it('reads as nothing read when the file does not exist', async () => {
    expect(await readInbox()).toEqual({ version: 1, allReadAt: NEVER, reads: {} })
  })

  it('reads the shape the contract names', async () => {
    await writeFile(
      join(dir, 'inbox.json'),
      JSON.stringify({
        version: 1,
        allReadAt: '2026-10-10T22:30:00.000Z',
        reads: { 'PSAPAC-3066': '2026-10-10T23:02:41.517+00:00' },
      }),
    )
    expect(await readInbox()).toEqual({
      version: 1,
      allReadAt: '2026-10-10T22:30:00.000Z',
      reads: { 'PSAPAC-3066': '2026-10-10T23:02:41.517Z' },
    })
  })

  it.each([
    ['a version this build does not know', { version: 2, allReadAt: NEVER, reads: {} }],
    ['a mark that is not a time', { version: 1, allReadAt: 'yesterday', reads: {} }],
    [
      'a read mark on a key that is not an issue',
      { version: 1, allReadAt: NEVER, reads: { x: NEVER } },
    ],
    ['no reads', { version: 1, allReadAt: NEVER }],
  ])('refuses %s', async (_name, body) => {
    await writeFile(join(dir, 'inbox.json'), JSON.stringify(body))
    expect((await failure(readInbox())).code).toBe('validation_failed')
  })

  it('refuses text that is not JSON, naming the file', async () => {
    await writeFile(join(dir, 'inbox.json'), '{')
    const error = await failure(readInbox())
    expect(error.code).toBe('validation_failed')
    expect(error.message).toContain('inbox.json')
  })
})

describe('the unread rule', () => {
  it('marks an issue unread when it changed after the later of allReadAt and its own mark', () => {
    const state = inbox('2026-10-05T00:00:00.000Z', { 'PSAPAC-1': '2026-10-08T00:00:00.000Z' })
    expect(readMark(state, 'PSAPAC-1')).toBe('2026-10-08T00:00:00.000Z')
    expect(readMark(state, 'PSAPAC-2')).toBe('2026-10-05T00:00:00.000Z')
    const at = (updated: string) => ({ key: 'PSAPAC-1', updated })
    expect(isUnread(state, at('2026-10-08T00:00:00.001Z'))).toBe(true)
    expect(isUnread(state, at('2026-10-08T00:00:00.000Z'))).toBe(false)
    expect(isUnread(state, { key: 'PSAPAC-2', updated: '2026-10-06T00:00:00.000Z' })).toBe(true)
  })

  it('ignores an own mark that allReadAt has passed', () => {
    const state = inbox('2026-10-09T00:00:00.000Z', { 'PSAPAC-1': '2026-10-07T00:00:00.000Z' })
    expect(readMark(state, 'PSAPAC-1')).toBe('2026-10-09T00:00:00.000Z')
  })

  it('reads every issue as unread when nothing has been marked', () => {
    expect(isUnread(inbox(NEVER), { key: 'PSAPAC-1', updated: '2026-09-28T00:00:00.000Z' })).toBe(
      true,
    )
  })
})

describe('marking read', () => {
  it('sets the issue mark to its updated time, keeping a later mark it already has', () => {
    const once = withRead(inbox(NEVER), 'PSAPAC-1', '2026-10-10T00:00:00.000+00:00', NOW)
    expect(once.reads).toEqual({ 'PSAPAC-1': '2026-10-10T00:00:00.000Z' })
    const older = withRead(once, 'PSAPAC-1', '2026-10-09T00:00:00.000Z', NOW)
    expect(older.reads['PSAPAC-1']).toBe('2026-10-10T00:00:00.000Z')
  })

  it('leaves a change that lands after the mark unread', () => {
    const state = withRead(inbox(NEVER), 'PSAPAC-1', '2026-10-10T00:00:00.000Z', NOW)
    expect(isUnread(state, { key: 'PSAPAC-1', updated: '2026-10-10T00:00:00.001Z' })).toBe(true)
  })

  it('sets allReadAt to the newest updated time and empties the marks it covers', () => {
    const state = inbox('2026-10-01T00:00:00.000Z', {
      'PSAPAC-1': '2026-10-09T00:00:00.000Z',
      'PSAPAC-2': '2026-10-10T12:00:00.000Z',
    })
    const all = withAllRead(state, '2026-10-10T00:00:00.000Z', NOW)
    expect(all.allReadAt).toBe('2026-10-10T00:00:00.000Z')
    // A mark past the new watermark is still the issue's own, so it stays.
    expect(all.reads).toEqual({ 'PSAPAC-2': '2026-10-10T12:00:00.000Z' })
  })

  it('never moves allReadAt back', () => {
    const state = inbox('2026-10-10T00:00:00.000Z')
    expect(withAllRead(state, '2026-10-05T00:00:00.000Z', NOW).allReadAt).toBe(
      '2026-10-10T00:00:00.000Z',
    )
  })

  it.each([
    ['a key that is not an issue', () => withRead(inbox(NEVER), 'x', NEVER, NOW)],
    ['a time that is not one', () => withRead(inbox(NEVER), 'PSAPAC-1', 'soon', NOW)],
    ['a watermark that is not a time', () => withAllRead(inbox(NEVER), 'soon', NOW)],
  ])('refuses %s', (_name, run) => {
    expect(run).toThrow(/Cannot mark/)
  })
})

describe('pruning', () => {
  it('drops marks that allReadAt covers and marks older than the window', () => {
    const edge = new Date(NOW.getTime() - INBOX_DAYS * 86_400_000).toISOString()
    const state = inbox('2026-10-05T00:00:00.000Z', {
      'PSAPAC-1': '2026-10-04T00:00:00.000Z',
      'PSAPAC-2': '2026-10-05T00:00:00.000Z',
      'PSAPAC-3': '2026-10-05T00:00:00.001Z',
    })
    expect(Object.keys(pruned(state, NOW).reads)).toEqual(['PSAPAC-3'])
    const old = inbox(NEVER, { 'PSAPAC-1': edge, 'PSAPAC-2': '2026-09-28T00:00:00.001Z' })
    expect(Object.keys(pruned(old, NOW).reads)).toEqual(['PSAPAC-2'])
  })

  it('runs on every write', async () => {
    await markRead('PSAPAC-1', '2026-08-01T00:00:00.000Z', NOW)
    await markRead('PSAPAC-2', '2026-10-09T00:00:00.000Z', NOW)
    expect(Object.keys((await readInbox()).reads)).toEqual(['PSAPAC-2'])
  })
})

describe('writing the file', () => {
  it('writes a mark and reads it back', async () => {
    await markRead('PSAPAC-3066', '2026-10-10T23:02:41.517Z', NOW)
    const file = JSON.parse(await readFile(join(dir, 'inbox.json'), 'utf8')) as unknown
    expect(file).toEqual({
      version: 1,
      allReadAt: NEVER,
      reads: { 'PSAPAC-3066': '2026-10-10T23:02:41.517Z' },
    })
  })

  it('marks everything read and drops the marks it covers', async () => {
    await markRead('PSAPAC-1', '2026-10-09T00:00:00.000Z', NOW)
    await markAllRead('2026-10-10T00:00:00.000Z', NOW)
    expect(await readInbox()).toEqual({
      version: 1,
      allReadAt: '2026-10-10T00:00:00.000Z',
      reads: {},
    })
  })
})
