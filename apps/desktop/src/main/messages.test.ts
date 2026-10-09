import { describe, expect, it } from 'vitest'

import { desktopMessage } from './messages'

describe('desktopMessage', () => {
  it.each([
    ['Not logged in. Run `jm auth login`.', 'Not logged in. Log in again.'],
    ['No project is set. Run `jm auth login`.', 'No project is set. Log in again.'],
    [
      'Field ids are not resolved. Run `jm auth login`.',
      'Field ids are not resolved. Log in again.',
    ],
    [
      'fields.json holds ids for OTHER on https://x.atlassian.net. Run `jm auth login` again.',
      'fields.json holds ids for OTHER on https://x.atlassian.net. Log in again.',
    ],
    [
      'Jira refused the credentials. Run `jm auth login` to sign in again.',
      'Jira refused the credentials. Log in again to continue.',
    ],
    [
      'OTHER-5 is not in PSAPAC. jm manages the PSAPAC project only.',
      'OTHER-5 is not in PSAPAC. This app manages the PSAPAC project only.',
    ],
    [
      'Created PSAPAC-9, but could not read it back (x). Do not create it again; read it with `jm issue get PSAPAC-9`.',
      'Created PSAPAC-9, but could not read it back (x). Do not create it again; open PSAPAC-9 to read it.',
    ],
    [
      'timer.json is held by another timer operation. Try again, or delete the file if no jm or app process is running.',
      'timer.json is held by another timer operation. Try again, or delete the file if no other process is using it.',
    ],
  ])('rewrites %j', (message, expected) => {
    expect(desktopMessage(message)).toBe(expected)
  })

  it('leaves a message with no CLI wording as it is', () => {
    const message =
      'Jira could not find PSAPAC-9. Check the key and that it exists in this project.'
    expect(desktopMessage(message)).toBe(message)
  })

  it('leaves no command-line wording in any message core can send the app', () => {
    const sent = [
      'Not logged in. Run `jm auth login`.',
      'The site URL in settings is not an https://<name>.atlassian.net site. Run `jm auth login` again.',
      'Jira rejected the request. Run `jm auth login` to sign in again.',
    ]
    for (const message of sent) expect(desktopMessage(message)).not.toMatch(/`?\bjm\b/)
  })
})
