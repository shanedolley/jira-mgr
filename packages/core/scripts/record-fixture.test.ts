import { describe, expect, it, vi } from 'vitest'

import { record } from './record-fixture.ts'

const ARGS = ['createmeta-story', 'GET', '/rest/api/3/issue/createmeta/PSAPAC/issuetypes/1']
const TOKEN = 'ATATT3xFfGF0-secret_token=ABC123'

function env(site: string) {
  return { JM_JIRA_SITE: site, JM_JIRA_EMAIL: 'shane@koinon.com.au', JM_JIRA_TOKEN: TOKEN }
}

describe('record', () => {
  it.each([
    'https://evil.example.com',
    'http://engineering-collibra.atlassian.net',
    'https://engineering-collibra.atlassian.net.evil.example.com',
    'https://user:pass@engineering-collibra.atlassian.net',
    'https://engineering-collibra.atlassian.net/path',
    'not a url',
  ])('refuses %s before any network call', async (site) => {
    const fetchFn = vi.fn<typeof fetch>()
    await expect(record(ARGS, env(site), fetchFn)).rejects.toThrow(
      'JM_JIRA_SITE must be https://<name>.atlassian.net',
    )
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('sends the request to the normalised site', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ ok: true })))
    const result = await record(
      ['--', ...ARGS],
      env('https://Engineering-Collibra.atlassian.net/'),
      fetchFn,
    )
    expect(result).toEqual({ name: 'createmeta-story', data: { ok: true } })
    expect(fetchFn).toHaveBeenCalledOnce()
    const [url, init] = fetchFn.mock.calls[0] ?? []
    expect(url).toBe(
      'https://engineering-collibra.atlassian.net/rest/api/3/issue/createmeta/PSAPAC/issuetypes/1',
    )
    expect(init?.redirect).toBe('error')
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      `Basic ${Buffer.from(`shane@koinon.com.au:${TOKEN}`).toString('base64')}`,
    )
  })

  it.each(['/rest/../x', '/rest/%2e%2e/x', '/rest/%2E%2E/x', '/rest/\\evil.com', '/other'])(
    'refuses the path %s before any network call',
    async (path) => {
      const fetchFn = vi.fn<typeof fetch>()
      await expect(
        record(['x', 'GET', path], env('https://a.atlassian.net'), fetchFn),
      ).rejects.toThrow('The path starts with /rest/')
      expect(fetchFn).not.toHaveBeenCalled()
    },
  )

  it('refuses a write before any network call', async () => {
    const fetchFn = vi.fn<typeof fetch>()
    await expect(
      record(
        ['x', 'DELETE', '/rest/api/3/issue/PSAPAC-1'],
        env('https://a.atlassian.net'),
        fetchFn,
      ),
    ).rejects.toThrow('records reads only')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
