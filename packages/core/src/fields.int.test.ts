import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { JIRA_SITE, serveCreatemeta, type CreatemetaField } from '../test/msw.js'
import { JiraMgrError } from './errors.js'
import { getFieldIds, resolveFields } from './fields.js'
import { createHttpClient } from './http.js'
import { writeFields, writeSettings } from './state.js'

const PSAPAC_IDS = {
  customer: 'customfield_14849',
  engagement: 'customfield_14850',
  sprint: 'customfield_10600',
  startDate: 'customfield_13808',
  timeRemaining: 'customfield_21785',
}

const http = createHttpClient({
  credentials: () => Promise.resolve({ siteUrl: JIRA_SITE, email: 'a@b.co', token: 'x' }),
})

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jm-fields-'))
  process.env.JM_STATE_DIR = dir
})

afterEach(async () => {
  delete process.env.JM_STATE_DIR
  await rm(dir, { recursive: true, force: true })
})

const without = (name: string) => (_type: string, fields: CreatemetaField[]) =>
  fields.filter((field) => field.name !== name)

/** Adds a second field named `name`, on the Epic only. */
const duplicate = (name: string) => (type: string, fields: CreatemetaField[]) =>
  type === 'epic' ? [...fields, { key: 'customfield_99999', name }] : fields

async function failure(promise: Promise<unknown>): Promise<JiraMgrError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(JiraMgrError)
  return error as JiraMgrError
}

describe('resolveFields', () => {
  it('resolves the five fields from the recorded PSAPAC createmeta', async () => {
    serveCreatemeta()
    expect(await resolveFields(http, 'PSAPAC')).toEqual(PSAPAC_IDS)
  })

  it('fails when the only type that lists a field stops listing it', async () => {
    // Time remaining (h) is on Story alone; Sprint and Start date are on several types.
    serveCreatemeta({ edit: (type, fields) => (type === 'story' ? [] : fields) })
    const error = await failure(resolveFields(http, 'PSAPAC'))
    expect(error.message).toContain('Time remaining (h) (missing)')
    expect(error.message).not.toContain('Sprint')
  })

  it('names every missing field and tells the user to set an override', async () => {
    serveCreatemeta({
      edit: (type, fields) => without('Sprint')(type, without('Customer')(type, fields)),
    })
    const error = await failure(resolveFields(http, 'PSAPAC'))
    expect(error.code).toBe('validation_failed')
    expect(error.message).toContain('Customer (missing)')
    expect(error.message).toContain('Sprint (missing)')
    expect(error.message).toContain('fieldOverrides')
  })

  it('fails on a name that maps to two field ids, naming both', async () => {
    serveCreatemeta({ edit: duplicate('Customer') })
    const error = await failure(resolveFields(http, 'PSAPAC'))
    expect(error.code).toBe('validation_failed')
    expect(error.message).toContain('Customer (ambiguous: customfield_14849, customfield_99999)')
  })

  it('does not match a field whose name only contains the wanted name', async () => {
    // PSAPAC has "Customer Reporting?" on Story.
    serveCreatemeta()
    expect((await resolveFields(http, 'PSAPAC')).customer).toBe('customfield_14849')
  })

  it('lets an override fix an ambiguous name', async () => {
    serveCreatemeta({ edit: duplicate('Customer') })
    const ids = await resolveFields(http, 'PSAPAC', { customer: 'customfield_99999' })
    expect(ids).toEqual({ ...PSAPAC_IDS, customer: 'customfield_99999' })
  })

  it('lets an override fix a missing name', async () => {
    serveCreatemeta({ edit: without('Engagement') })
    const ids = await resolveFields(http, 'PSAPAC', { engagement: 'customfield_16367' })
    expect(ids.engagement).toBe('customfield_16367')
  })

  it('wins over a name that resolves', async () => {
    serveCreatemeta()
    const ids = await resolveFields(http, 'PSAPAC', { sprint: 'customfield_16367' })
    expect(ids.sprint).toBe('customfield_16367')
  })

  it('fails an override id that is on no issue type', async () => {
    serveCreatemeta()
    const error = await failure(resolveFields(http, 'PSAPAC', { sprint: 'customfield_00001' }))
    expect(error.code).toBe('validation_failed')
    expect(error.message).toContain(
      'Sprint (override customfield_00001 is on no PSAPAC issue type)',
    )
  })

  it('follows every page of the issue types and of each type', async () => {
    const requested = serveCreatemeta({ pageSize: 2 })
    expect(await resolveFields(http, 'PSAPAC')).toEqual(PSAPAC_IDS)
    // 5 issue types in pages of 2, and 29 Story fields in pages of 2.
    expect(requested).toContain(
      '/rest/api/3/issue/createmeta/PSAPAC/issuetypes?startAt=4&maxResults=50',
    )
    expect(requested).toContain(
      '/rest/api/3/issue/createmeta/PSAPAC/issuetypes/11502?startAt=28&maxResults=50',
    )
  })
})

describe('getFieldIds', () => {
  const stored = {
    site: JIRA_SITE,
    project: 'PSAPAC',
    resolvedAt: '2026-10-07T00:00:00.000Z',
    ids: PSAPAC_IDS,
  }

  it('returns the stored ids with settings overrides applied', async () => {
    await writeSettings({
      siteUrl: JIRA_SITE,
      projectKey: 'PSAPAC',
      fieldOverrides: { sprint: 'customfield_10601' },
    })
    await writeFields(stored)
    expect(await getFieldIds()).toEqual({ ...PSAPAC_IDS, sprint: 'customfield_10601' })
  })

  it('fails with permission_denied when fields.json is missing', async () => {
    const error = await failure(getFieldIds())
    expect(error.code).toBe('permission_denied')
    expect(error.message).toContain('jm auth login')
  })

  it.each([
    ['another site', { siteUrl: 'https://other.atlassian.net', projectKey: 'PSAPAC' }],
    ['another project', { siteUrl: JIRA_SITE, projectKey: 'OTHER' }],
  ])('fails when settings name %s', async (_name, settings) => {
    await writeSettings(settings)
    await writeFields(stored)
    expect((await failure(getFieldIds())).code).toBe('validation_failed')
  })
})
