import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JiraMgrError } from '@jira-mgr/core'
import type { HttpClient } from '@jira-mgr/core/http'
import { writeFields, writeSettings } from '@jira-mgr/core/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createBackend } from './backend'

const SITE = 'https://team.atlassian.net'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jm-desktop-state-'))
  process.env.JM_STATE_DIR = dir
})
afterEach(async () => {
  delete process.env.JM_STATE_DIR
  await rm(dir, { recursive: true, force: true })
})

async function logIn() {
  await writeSettings({ siteUrl: SITE, projectKey: 'PSAPAC', email: 'me@example.com' })
  await writeFields({
    site: SITE,
    project: 'PSAPAC',
    resolvedAt: '2026-10-09T00:00:00.000Z',
    ids: {
      customer: 'customfield_1',
      engagement: 'customfield_2',
      sprint: 'customfield_3',
      startDate: 'customfield_4',
      timeRemaining: 'customfield_5',
    },
  })
}

/** An HTTP client that records every request and answers none, so a test sees what would be sent. */
function recordingHttp() {
  const requests: { method: string; path: string; body: unknown }[] = []
  const http: HttpClient = {
    request(method, path, options) {
      requests.push({ method, path, body: options?.body })
      return Promise.resolve(undefined)
    },
  }
  return { http, requests }
}

describe('setSummary', () => {
  it('refuses an issue of another project before any request is sent', async () => {
    await logIn()
    const { http, requests } = recordingHttp()
    const error = await createBackend({ http })
      .setSummary({ key: 'OTHER-5', summary: 'New' })
      .then(
        () => undefined,
        (e: unknown) => e,
      )
    expect(error).toBeInstanceOf(JiraMgrError)
    expect(error).toMatchObject({
      code: 'validation_failed',
      message: 'OTHER-5 is not in PSAPAC. jm manages the PSAPAC project only.',
    })
    expect(requests).toEqual([])
  })

  it('refuses every write when no project is set', async () => {
    const { http, requests } = recordingHttp()
    await expect(
      createBackend({ http }).setSummary({ key: 'PSAPAC-12', summary: 'New' }),
    ).rejects.toMatchObject({ code: 'permission_denied' })
    expect(requests).toEqual([])
  })

  it('edits an issue of the project with one PUT holding the summary', async () => {
    await logIn()
    const { http, requests } = recordingHttp()
    await createBackend({ http }).setSummary({ key: 'PSAPAC-12', summary: 'New' })
    expect(requests).toEqual([
      { method: 'PUT', path: '/rest/api/3/issue/PSAPAC-12', body: { fields: { summary: 'New' } } },
    ])
  })
})
