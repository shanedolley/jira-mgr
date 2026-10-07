import { vi } from 'vitest'

// No CLI test may reach the real Keychain. Core runs `/usr/bin/security` through `spawn`, so a
// test that forgets to inject a fake Keychain fails here instead of reading or writing real items.
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: () => {
    throw new Error(
      'A CLI test tried to start a process. Inject a fake Keychain with fakeSecurity().',
    )
  },
}))
