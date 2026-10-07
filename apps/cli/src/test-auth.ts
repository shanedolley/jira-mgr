import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createKeychain, type SecurityRunner } from '@jira-mgr/core/auth'
import { afterEach, beforeEach, expect } from 'vitest'

import type { fakeIo } from './test-io.js'

export const EMAIL = 'me@example.com'
export const TOKEN = 'ATATT3xFfGF0-secret_token=ABC123'

/**
 * A fake `/usr/bin/security` holding items in memory, behind core's real Keychain code. `fail`
 * makes every command exit 1, as a locked Keychain does.
 */
export function fakeSecurity(options: { fail?: boolean } = {}) {
  const calls: { args: string[]; stdin?: string }[] = []
  const items = new Map<string, string>()
  const run: SecurityRunner = (args, stdin) => {
    calls.push({ args, stdin })
    if (options.fail) return Promise.resolve({ status: 1, stdout: '' })
    const account = args.includes('-a') ? args[args.indexOf('-a') + 1] : undefined
    if (args[0] === '-i') {
      const stored = /-a "([^"]*)" -w "([^"]*)"/.exec(stdin ?? '')
      if (stored?.[1] !== undefined && stored[2] !== undefined) items.set(stored[1], stored[2])
      return Promise.resolve({ status: 0, stdout: '' })
    }
    if (args[0] === 'find-generic-password') {
      const token = account === undefined ? undefined : items.get(account)
      return Promise.resolve(
        token === undefined ? { status: 44, stdout: '' } : { status: 0, stdout: `${token}\n` },
      )
    }
    const target = account ?? items.keys().next().value
    const found = target !== undefined && items.delete(target)
    return Promise.resolve({ status: found ? 0 : 44, stdout: '' })
  }
  return { calls, items, keychain: createKeychain({ run }) }
}

/** Gives each test an empty state folder, so there are no settings and no field ids. */
export function useEmptyState(): void {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'jm-cli-state-'))
    process.env.JM_STATE_DIR = dir
  })
  afterEach(async () => {
    delete process.env.JM_STATE_DIR
    await rm(dir, { recursive: true, force: true })
  })
}

/** Fails when the token reached stdout or stderr, where an error or a result would print it. */
export function expectNoToken(f: ReturnType<typeof fakeIo>): void {
  expect(f.stdout).not.toContain(TOKEN)
  expect(f.stderr).not.toContain(TOKEN)
  expect(f.stdout).not.toContain(Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64'))
}
