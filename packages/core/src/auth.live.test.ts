import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { createKeychain } from './auth.js'

// Not a Jira test, so `pnpm test:live` does not enable it: set JM_LIVE_KEYCHAIN=1 yourself.
describe.runIf(process.platform === 'darwin' && process.env.JM_LIVE_KEYCHAIN === '1')(
  'real /usr/bin/security',
  () => {
    it('round-trips a token through a throwaway service', async () => {
      const keychain = createKeychain({ service: `jira-mgr-test-${randomUUID()}` })
      const email = 'keychain-test@example.com'
      const token = 'tok#en=+/ with space'
      try {
        await keychain.set(email, token)
        expect(await keychain.get(email)).toBe(token)
        await keychain.set(email, 'second')
        expect(await keychain.get(email)).toBe('second')
        await keychain.deleteAll()
        expect(await keychain.get(email)).toBeNull()
      } finally {
        await keychain.deleteAll()
      }
    })
  },
)
