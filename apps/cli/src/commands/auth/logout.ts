import { logout as removeLogin } from '@jira-mgr/core/auth'

import type { Handler } from '../../context.js'
import type { SpecOf } from '../../schema.js'

/** `jm auth logout`: removes every jira-mgr Keychain item. Succeeds when already logged out. */
export const logout: Handler<SpecOf<'auth logout'>, { loggedOut: true }> = {
  async run(_input, ctx) {
    await removeLogin({ keychain: ctx.keychain })
    return { loggedOut: true }
  },
  render: () => 'Logged out. The token is removed from the Keychain.',
}
