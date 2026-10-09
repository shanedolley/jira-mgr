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
  /** Search pages served, per phase. */
  searches: { unresolved: number; done: number }
  /** Done pages requested before the unresolved phase had served its last page. */
  doneEarly: number
  /** Edits received. */
  edits: number
  /** Edits applied, which happens when a test calls `releaseEdit`. */
  applied: number
}

export interface FakeJiraOptions {
  /** Open Stories to add under one open Epic of the internal Customer, which sorts last, for the virtual window. */
  bulk?: number
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
  done: { id: '3', name: 'Done', statusCategory: { key: 'done' } },
} as const

const TYPES = {
  epic: { id: '9', name: 'Epic', subtask: false, hierarchyLevel: 1 },
  story: { id: '10', name: 'Story', subtask: false, hierarchyLevel: 0 },
  bug: { id: '11', name: 'Bug', subtask: false, hierarchyLevel: 0 },
  task: { id: '12', name: 'Task', subtask: false, hierarchyLevel: 0 },
  subtask: { id: '13', name: 'Subtask', subtask: true, hierarchyLevel: -1 },
}

/** The Customer options. Zeta Corp has no issues. */
const CUSTOMERS = {
  acme: { id: '1', value: 'Acme' },
  beta: { id: '2', value: 'Beta Ltd' },
  internal: { id: '3', value: 'Collibra (Internal team)' },
  zeta: { id: '4', value: 'Zeta Corp' },
}

const USERS = {
  u1: { accountId: 'u1', displayName: 'Test User', avatarUrls: {} },
  u2: { accountId: 'u2', displayName: 'Other User', avatarUrls: {} },
}

const SPRINT = { id: 5, name: 'Sprint 5', state: 'active' }

interface Seed {
  n: number
  summary: string
  type: keyof typeof TYPES
  status: keyof typeof STATUSES
  parent?: number
  customer: keyof typeof CUSTOMERS
  assignee?: keyof typeof USERS
  labels?: string[]
  sprint?: boolean
}

/**
 * The project. PSAPAC-1 to PSAPAC-4 keep the D1 summaries, types, statuses and assignees, now
 * under one Epic. The rest cover each Tree case: Done children behind a chip, a Done Epic with
 * one open and one Done child, a Story whose Customer differs from its Epic's, a Story with no
 * Epic, and an internal Customer.
 */
const SEEDS: Seed[] = [
  { n: 10, summary: 'Customer onboarding', type: 'epic', status: 'todo', customer: 'acme' },
  {
    n: 1,
    summary: 'Kick off the engagement',
    type: 'story',
    status: 'doing',
    parent: 10,
    customer: 'acme',
  },
  {
    n: 2,
    summary: 'Review the data model',
    type: 'story',
    status: 'todo',
    parent: 10,
    customer: 'acme',
    assignee: 'u1',
  },
  {
    n: 3,
    summary: 'Fix the export timeout',
    type: 'bug',
    status: 'todo',
    parent: 10,
    customer: 'acme',
  },
  {
    n: 4,
    summary: 'Migrate the dashboards',
    type: 'story',
    status: 'doing',
    parent: 10,
    customer: 'acme',
    assignee: 'u1',
  },
  {
    n: 11,
    summary: 'Draft the runbook',
    type: 'story',
    status: 'todo',
    parent: 10,
    customer: 'acme',
    assignee: 'u2',
    labels: ['docs'],
  },
  {
    n: 12,
    summary: 'Outline the sections',
    type: 'subtask',
    status: 'todo',
    parent: 11,
    customer: 'acme',
    assignee: 'u1',
  },
  {
    n: 13,
    summary: 'Book the kickoff',
    type: 'task',
    status: 'doing',
    parent: 10,
    customer: 'acme',
    sprint: true,
  },
  {
    n: 14,
    summary: 'Collect the access list',
    type: 'story',
    status: 'done',
    parent: 10,
    customer: 'acme',
  },
  {
    n: 15,
    summary: 'Confirm the scope',
    type: 'story',
    status: 'done',
    parent: 10,
    customer: 'acme',
  },
  { n: 20, summary: 'Platform migration', type: 'epic', status: 'done', customer: 'beta' },
  {
    n: 21,
    summary: 'Plan the cutover',
    type: 'story',
    status: 'todo',
    parent: 20,
    customer: 'beta',
    assignee: 'u1',
  },
  {
    n: 22,
    summary: 'Migrate the schema',
    type: 'story',
    status: 'done',
    parent: 20,
    customer: 'beta',
  },
  { n: 30, summary: 'Reporting', type: 'epic', status: 'doing', customer: 'beta' },
  {
    n: 31,
    summary: 'Build the monthly report',
    type: 'story',
    status: 'todo',
    parent: 30,
    customer: 'acme',
  },
  {
    n: 32,
    summary: 'Review the report layout',
    type: 'story',
    status: 'todo',
    parent: 30,
    customer: 'beta',
    assignee: 'u2',
  },
  { n: 40, summary: 'Tidy the wiki', type: 'story', status: 'todo', customer: 'beta' },
  { n: 50, summary: 'Internal tooling', type: 'epic', status: 'todo', customer: 'internal' },
  {
    n: 51,
    summary: 'Automate the release notes',
    type: 'story',
    status: 'todo',
    parent: 50,
    customer: 'internal',
  },
]

function issue(seed: Seed) {
  return {
    id: String(1000 + seed.n),
    key: `PSAPAC-${String(seed.n)}`,
    fields: {
      summary: seed.summary,
      issuetype: TYPES[seed.type],
      status: STATUSES[seed.status],
      labels: seed.labels ?? [],
      created: '2026-10-01T00:00:00.000+1000',
      updated: '2026-10-02T00:00:00.000+1000',
      assignee: seed.assignee === undefined ? null : USERS[seed.assignee],
      parent: seed.parent === undefined ? null : { key: `PSAPAC-${String(seed.parent)}` },
      [FIELDS.customer]: CUSTOMERS[seed.customer],
      [FIELDS.sprint]: seed.sprint === true ? [SPRINT] : null,
    },
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const keyNumber = (key: string) => Number(key.slice(key.lastIndexOf('-') + 1))

/** A `fetch` that serves the Jira calls login, field lookups, search and edit make. Any other URL throws. */
export function createFakeJira(options: FakeJiraOptions = {}): {
  fetch: typeof fetch
  counts: FakeJiraCounts
  /** Lets the oldest held edit proceed. The test waits for `counts.edits` first, so one is held. */
  releaseEdit: () => void
  /** Lets the first Done page proceed. Until then no Done issue has loaded, with no timing window. */
  releaseDone: () => void
  /** Makes the next Done page answer 500. */
  failDone: () => void
} {
  const bulk = Array.from({ length: options.bulk ?? 0 }, (_, i) =>
    issue({
      n: 1000 + i,
      summary: `Bulk story ${String(i + 1)}`,
      type: 'story',
      status: 'todo',
      parent: 900,
      customer: 'internal',
    }),
  )
  const issues = [
    ...SEEDS.map(issue),
    ...(bulk.length === 0
      ? []
      : [
          issue({
            n: 900,
            summary: 'Bulk epic',
            type: 'epic',
            status: 'todo',
            customer: 'internal',
          }),
        ]),
    ...bulk,
  ]
  const counts: FakeJiraCounts = {
    searches: { unresolved: 0, done: 0 },
    doneEarly: 0,
    edits: 0,
    applied: 0,
  }
  let unresolvedComplete = false
  // Every edit waits here, so a test sees the optimistic state with Jira's answer still pending.
  const held: (() => void)[] = []
  // The first Done page waits here, so a test sees the Tree before Done issues arrive.
  let releaseFirstDone!: () => void
  const firstDone = new Promise<void>((resolve) => {
    releaseFirstDone = resolve
  })
  let doneHeld = false
  let failNextDone = false

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
      return json({ total: 1, issueTypes: [{ id: '10', name: 'Story' }] })
    }
    if (method === 'GET' && path === '/rest/api/3/issue/createmeta/PSAPAC/issuetypes/10') {
      const names = ['Customer', 'Engagement', 'Sprint', 'Start date', 'Time remaining (h)']
      const fields = Object.values(FIELDS).map((key, i) => ({
        key,
        name: names[i],
        ...(key === FIELDS.customer ? { allowedValues: Object.values(CUSTOMERS) } : {}),
      }))
      return json({ total: fields.length, fields })
    }
    if (method === 'POST' && path === '/rest/api/3/search/jql') {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        jql: string
        maxResults: number
        nextPageToken?: string
      }
      // "!= Done" holds "= Done" as a substring, so test it first.
      const phase = body.jql.includes('statusCategory != Done') ? 'unresolved' : 'done'
      if (phase === 'done' && !unresolvedComplete) counts.doneEarly++
      if (phase === 'done' && !doneHeld) {
        doneHeld = true
        await firstDone
      }
      if (phase === 'done' && failNextDone) {
        failNextDone = false
        return json({ errorMessages: ['The fake failed this page.'] }, 500)
      }
      counts.searches[phase]++
      const matching = issues
        .filter((i) => (i.fields.status.statusCategory.key === 'done') === (phase === 'done'))
        .sort((a, b) => keyNumber(b.key) - keyNumber(a.key))
      const start = Number(body.nextPageToken ?? '0')
      const end = start + body.maxResults
      if (phase === 'unresolved' && end >= matching.length) unresolvedComplete = true
      return json({
        issues: matching.slice(start, end),
        isLast: end >= matching.length,
        nextPageToken: String(end),
      })
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
    releaseDone: () => {
      releaseFirstDone()
    },
    failDone: () => {
      failNextDone = true
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
