import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { JiraMgrError } from './errors.js'
import { readTimer } from './state.js'
import { startTimer } from './timer.js'

// A separate file, because it wraps `readFile` to run code between the stale check and the rename.
const hook = vi.hoisted(() => ({ afterLockRead: null as (() => void) | null }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: (async (...args: Parameters<typeof actual.readFile>) => {
      const text = await actual.readFile(...args)
      if (typeof args[0] === 'string' && args[0].endsWith('.lock') && hook.afterLockRead) {
        const run = hook.afterLockRead
        hook.afterLockRead = null
        run()
      }
      return text
    }) as typeof actual.readFile,
  }
})

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jm-timer-lock-'))
  process.env.JM_STATE_DIR = dir
})

afterEach(async () => {
  hook.afterLockRead = null
  delete process.env.JM_STATE_DIR
  await rm(dir, { recursive: true, force: true })
})

it('keeps a lock taken between the stale check and the rename', async () => {
  const lock = join(dir, 'timer.json.lock')
  writeFileSync(lock, JSON.stringify({ pid: 2 ** 22 + 12345, at: Date.now(), token: 'dead' }))
  const live = JSON.stringify({ pid: process.pid, at: Date.now(), token: 'live' })
  // The dead holder's lock is read as stale; before the rename, a new holder replaces it.
  hook.afterLockRead = () => {
    writeFileSync(`${lock}.new`, live)
    renameSync(`${lock}.new`, lock)
  }
  const error = await startTimer(
    { key: 'PSAPAC-1', issueType: { name: 'Task' } },
    { lock: { waitMs: 100, pollMs: 5 } },
  ).then(
    () => undefined,
    (e: unknown) => e,
  )
  // The new holder keeps its lock, so the reclaimer waits and times out.
  expect(error).toBeInstanceOf(JiraMgrError)
  expect(readFileSync(lock, 'utf8')).toBe(live)
  expect(await readTimer()).toBeNull()
})
