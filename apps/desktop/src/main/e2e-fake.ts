import { createKeychain, type Keychain, type SecurityRunner } from '@jira-mgr/core/auth'

/**
 * Test doubles for the e2e entry: a Jira that answers from memory and a Keychain that never
 * runs `/usr/bin/security`. Core still runs for real on top of them.
 */

export const FAKE_SITE = 'https://fake.atlassian.net'
export const FAKE_TOKEN = 'good-token'
/** A summary the fake Jira refuses, so a test can watch an optimistic edit roll back. */
export const REJECTED_SUMMARY = 'reject me'

export interface FakeJiraCounts {
  searches: number
  /** Edits received. */
  edits: number
  /** Edits applied, which happens when a test calls `releaseEdit`. */
  applied: number
}

const FIELDS = {
  customer: 'customfield_1',
  engagement: 'customfield_2',
  sprint: 'customfield_3',
  startDate: 'customfield_4',
  timeRemaining: 'customfield_5',
}

const STATUSES = {
  todo: { id: '1', name: 'To Do', statusCategory: { key: 'new' } },
  doing: { id: '2', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
} as const

const TYPES = {
  story: { id: '10', name: 'Story', subtask: false, hierarchyLevel: 0 },
  bug: { id: '11', name: 'Bug', subtask: false, hierarchyLevel: 0 },
}

function issue(
  n: number,
  summary: string,
  type: keyof typeof TYPES,
  status: keyof typeof STATUSES,
) {
  return {
    id: String(1000 + n),
    key: `PSAPAC-${String(n)}`,
    fields: {
      summary,
      issuetype: TYPES[type],
      status: STATUSES[status],
      labels: [],
      created: '2026-10-01T00:00:00.000+1000',
      updated: '2026-10-02T00:00:00.000+1000',
      assignee: n % 2 === 0 ? { accountId: 'u1', displayName: 'Test User', avatarUrls: {} } : null,
      [FIELDS.customer]: { id: '1', value: 'Acme' },
    },
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A `fetch` that serves the Jira calls login, search and edit make. Any other URL throws. */
export function createFakeJira(): {
  fetch: typeof fetch
  counts: FakeJiraCounts
  /** Lets the oldest held edit proceed. The test waits for `counts.edits` first, so one is held. */
  releaseEdit: () => void
} {
  const issues = [
    issue(4, 'Migrate the dashboards', 'story', 'doing'),
    issue(3, 'Fix the export timeout', 'bug', 'todo'),
    issue(2, 'Review the data model', 'story', 'todo'),
    issue(1, 'Kick off the engagement', 'story', 'doing'),
  ]
  const counts: FakeJiraCounts = { searches: 0, edits: 0, applied: 0 }
  // Every edit waits here, so a test sees the optimistic state with Jira's answer still pending.
  const held: (() => void)[] = []

  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.origin !== FAKE_SITE) throw new Error(`The e2e fake refuses ${url.origin}.`)
    const method = (init?.method ?? 'GET').toUpperCase()
    const auth = new Headers(init?.headers).get('authorization')
    const expected = `Basic ${Buffer.from(`me@example.com:${FAKE_TOKEN}`).toString('base64')}`
    if (auth !== expected) return json({ errorMessages: ['Bad credentials.'] }, 401)

    const path = url.pathname
    if (method === 'GET' && path === '/rest/api/3/myself') {
      return json({ accountId: 'u1', displayName: 'Test User' })
    }
    if (method === 'GET' && path === '/rest/api/3/issue/createmeta/PSAPAC/issuetypes') {
      return json({ total: 1, issueTypes: [{ id: '10' }] })
    }
    if (method === 'GET' && path === '/rest/api/3/issue/createmeta/PSAPAC/issuetypes/10') {
      const names = ['Customer', 'Engagement', 'Sprint', 'Start date', 'Time remaining (h)']
      const fields = Object.values(FIELDS).map((key, i) => ({ key, name: names[i] }))
      return json({ total: fields.length, fields })
    }
    if (method === 'POST' && path === '/rest/api/3/search/jql') {
      counts.searches++
      return json({ issues, isLast: true })
    }
    const edit = /^\/rest\/api\/3\/issue\/(PSAPAC-\d+)$/.exec(path)
    if (method === 'PUT' && edit !== null) {
      counts.edits++
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        fields: { summary: string }
      }
      const target = issues.find((i) => i.key === edit[1])
      if (target === undefined) return json({ errorMessages: ['Issue does not exist.'] }, 404)
      await new Promise<void>((resolve) => held.push(resolve))
      if (body.fields.summary === REJECTED_SUMMARY) {
        return json(
          { errorMessages: [], errors: { summary: 'The fake refuses this summary.' } },
          400,
        )
      }
      target.fields.summary = body.fields.summary
      counts.applied++
      return new Response(null, { status: 204 })
    }
    return json({ errorMessages: [`The e2e fake has no ${method} ${path}.`] }, 404)
  }
  return {
    fetch: fakeFetch,
    counts,
    releaseEdit: () => {
      held.shift()?.()
    },
  }
}

/** Core's real Keychain code over an in-memory `security`. */
export function createFakeKeychain(): Keychain {
  const items = new Map<string, string>()
  const run: SecurityRunner = (args, stdin) => {
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
  return createKeychain({ run })
}
