import { describe, expect, it } from 'vitest'

import { JIRA_SITE, serveFixture } from './msw.js'

interface Search {
  issues: { key: string }[]
}
interface FieldMeta {
  key: string
  name: string
  allowedValues?: unknown[]
}
interface IssueTypes {
  issueTypes: { id: string }[]
}

// The shapes above describe only what these tests assert on the recorded bodies.
const getJson = async <T>(path: string, init?: RequestInit) =>
  (await (await fetch(`${JIRA_SITE}${path}`, init)).json()) as T

describe('recorded PSAPAC fixtures', () => {
  it('serves the recorded search with PSAPAC issue keys', async () => {
    serveFixture('post', '/rest/api/3/search/jql', 'search-psapac')

    const search = await getJson<Search>('/rest/api/3/search/jql', { method: 'POST' })

    expect(search.issues.length).toBeGreaterThan(0)
    for (const issue of search.issues) expect(issue.key).toMatch(/^PSAPAC-\d+$/)
  })

  it('serves the Story createmeta with Customer and its allowed values', async () => {
    serveFixture('get', '/rest/api/3/issue/createmeta/PSAPAC/issuetypes/11502', 'createmeta-story')

    const meta = await getJson<{ fields: FieldMeta[] }>(
      '/rest/api/3/issue/createmeta/PSAPAC/issuetypes/11502',
    )
    const customer = meta.fields.find((field) => field.key === 'customfield_14849')

    expect(customer?.name).toBe('Customer')
    expect(customer?.allowedValues?.length).toBeGreaterThan(0)
  })

  it('serves the issue types createmeta with a Story', async () => {
    serveFixture('get', '/rest/api/3/issue/createmeta/PSAPAC/issuetypes', 'createmeta-issuetypes')

    const meta = await getJson<IssueTypes>('/rest/api/3/issue/createmeta/PSAPAC/issuetypes')

    expect(meta.issueTypes.map((type) => type.id)).toContain('11502')
  })
})
