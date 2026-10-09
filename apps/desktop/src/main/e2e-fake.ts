import { createKeychain, type Keychain, type SecurityRunner } from '@jira-mgr/core/auth'

/**
 * Test doubles for the e2e entry: a Jira that answers from memory and a Keychain that never
 * runs `/usr/bin/security`. Core still runs for real on top of them.
 */

export const FAKE_SITE = 'https://fake.atlassian.net'
export const FAKE_TOKEN = 'good-token'
/** A summary the fake Jira refuses, so a test can watch an optimistic edit roll back. */
export const REJECTED_SUMMARY = 'reject me'
/** The priority the fake Jira refuses, so a test can watch a picker edit roll back. */
export const REJECTED_PRIORITY = 'Highest'
/** The issue the fake refuses to delete, so a test can watch a delete roll back. */
export const REJECTED_DELETE = 'PSAPAC-3'
/** A 1 by 1 PNG, so an attached image has a real size to decode. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
/** The media id of the image PSAPAC-1's description embeds, which belongs to its attachment 5001. */
export const SEED_MEDIA_ID = 'aaaaaaaa-0000-4000-8000-000000005001'
/** The first id an uploaded attachment gets. */
const FIRST_UPLOADED = 6000

/** The media id Jira would give attachment `id`, built so a test can predict it. */
const mediaIdOf = (id: number) => `aaaaaaaa-0000-4000-8000-${String(id).padStart(12, '0')}`

/**
 * PSAPAC-1's description: every kind of content the editor must keep. The panel, the table, the
 * mention and the image are read-only; the paragraphs and the linked code are editable.
 */
const RICH_DESCRIPTION = {
  version: 1,
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { localId: 'p-scope' },
      content: [{ type: 'text', text: 'Agree the scope with the sponsor.' }],
    },
    {
      type: 'panel',
      attrs: { panelType: 'info' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Panel kept as it is.' }] }],
    },
    {
      type: 'table',
      attrs: { isNumberColumnEnabled: false, layout: 'default' },
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              attrs: {},
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell A' }] }],
            },
            {
              type: 'tableCell',
              attrs: {},
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell B' }] }],
            },
          ],
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Ask ' },
        { type: 'mention', attrs: { id: 'u2', text: '@Other User' } },
        { type: 'text', text: ' to run ' },
        {
          type: 'text',
          text: 'make test',
          marks: [{ type: 'code' }, { type: 'link', attrs: { href: 'https://example.test/docs' } }],
        },
        { type: 'text', text: '.' },
      ],
    },
    {
      type: 'mediaSingle',
      attrs: { layout: 'center' },
      content: [
        {
          type: 'media',
          attrs: {
            type: 'file',
            id: SEED_MEDIA_ID,
            collection: '',
            alt: 'diagram.png',
            width: 1,
            height: 1,
          },
        },
      ],
    },
  ],
}

/** The first number a created issue gets, clear of the seeds and of `JM_E2E_BULK`'s 1000 to 1999. */
const FIRST_CREATED = 2000

export interface FakeJiraCounts {
  /** Search pages served, per phase. */
  searches: { unresolved: number; done: number }
  /** Done pages requested before the unresolved phase had served its last page. */
  doneEarly: number
  /** Writes received: edits, transitions and sprint moves. */
  edits: number
  /** Writes applied, which happens when a test calls `releaseEdit`. */
  applied: number
  /** Reads of one issue, in order of arrival. */
  issueReads: string[]
  /**
   * The body of every write received, in order: an edit's request body, a create's request body,
   * and for a delete `{ delete: key, deleteSubtasks }`.
   */
  editBodies: unknown[]
  /** Attachment uploads received, in order of arrival. */
  uploads: { key: string; filename: string; type: string; size: number }[]
  /** Links the app opened in a browser, as the e2e entry's stand-in for `shell.openExternal` saw them. */
  openExternal: string[]
  /** Times the quit prompt was raised. */
  quitPrompts: number
  /** Every avatar request, in order, with whether it carried an Authorization header. */
  avatarFetches: { url: string; authorized: boolean }[]
}

export interface FakeJiraOptions {
  /** Open Stories to add under one open Epic of the internal Customer, which sorts last, for the virtual window. */
  bulk?: number
  /** Applies the PSAPAC automation this many ms after a create, not at once, as the live rule does. */
  lateAutomationMs?: number
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

const ENGAGEMENTS = {
  north: { id: '7', value: 'North' },
  south: { id: '8', value: 'South' },
}

const MEDIUM = { id: '3', name: 'Medium' }
const PRIORITIES = [
  { id: '1', name: 'Highest' },
  { id: '2', name: 'High' },
  MEDIUM,
  { id: '4', name: 'Low' },
]

/** Where the fake serves profile images, off the Jira site as the real ones are. */
const AVATAR_HOST = 'https://avatars.fake.atl-paas.net'
/** A 1x1 PNG. */
const AVATAR_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const USERS = {
  // Has an image.
  u1: {
    accountId: 'u1',
    displayName: 'Test User',
    avatarUrls: { '48x48': `${AVATAR_HOST}/u1/48` },
  },
  // Names an image the host does not have, so it falls back to initials.
  u2: {
    accountId: 'u2',
    displayName: 'Other User',
    avatarUrls: { '48x48': `${AVATAR_HOST}/gone/48` },
  },
  // Has none. Assigned to nothing, so only the assignee search finds this user.
  u3: { accountId: 'u3', displayName: 'Cy Young', avatarUrls: {} },
}

/** The board's sprints: one active, a dated and an undated future one, and a closed one. */
const SPRINTS = [
  { id: 4, name: 'Sprint 4', state: 'closed', startDate: '2026-09-01T00:00:00.000Z' },
  { id: 5, name: 'Sprint 5', state: 'active', startDate: '2026-10-01T00:00:00.000Z' },
  { id: 6, name: 'Sprint 6', state: 'future', startDate: '2026-10-15T00:00:00.000Z' },
  { id: 7, name: 'PS TEMPLATES', state: 'future' },
]

const BOARD_ID = 7

interface Seed {
  n: number
  summary: string
  type: keyof typeof TYPES
  status: keyof typeof STATUSES
  parent?: number
  customer: keyof typeof CUSTOMERS
  engagement?: keyof typeof ENGAGEMENTS
  assignee?: keyof typeof USERS
  labels?: string[]
  sprint?: number
  /** The original estimate in seconds. The remaining estimate starts equal. */
  estimate?: number
  /** One paragraph of description. */
  description?: string
  /** The description holds every kind of content, and the issue has one image attached. */
  rich?: true
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
    rich: true,
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
    estimate: 7200,
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
    sprint: 5,
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
  {
    n: 30,
    summary: 'Reporting',
    type: 'epic',
    status: 'doing',
    customer: 'beta',
    engagement: 'south',
  },
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

interface RawFields {
  summary: string
  issuetype: (typeof TYPES)[keyof typeof TYPES]
  status: (typeof STATUSES)[keyof typeof STATUSES]
  labels: string[]
  updated: string
  assignee: (typeof USERS)[keyof typeof USERS] | null
  parent: { key: string } | null
  priority: (typeof PRIORITIES)[number]
  duedate: string | null
  timetracking: { originalEstimateSeconds?: number; remainingEstimateSeconds?: number }
  description: unknown
  /** The custom fields, by the ids in `FIELDS`. */
  [field: string]: unknown
}

/** The body of an issue create, as far as the fake reads it. */
interface CreateBody {
  fields?: Record<string, unknown>
}

/** The body of an issue edit, as far as the fake reads it. */
interface EditBody {
  fields?: Record<string, unknown>
  update?: {
    labels?: ({ add: string } | { remove: string })[]
    timetracking?: { edit: { originalEstimate: string } }[]
  }
}

interface Attachment {
  id: number
  filename: string
  mediaId: string
  mimeType: string
  bytes: Uint8Array
}

const png = () => new Uint8Array(Buffer.from(PNG_BASE64, 'base64'))

/** The attachment as Jira's REST responses show it: no media id, which only the content redirect gives. */
const rawAttachment = (a: Attachment) => ({
  id: String(a.id),
  filename: a.filename,
  size: a.bytes.length,
  mimeType: a.mimeType,
  created: '2026-10-01T00:00:00.000+1000',
  content: `${FAKE_SITE}/rest/api/3/attachment/content/${String(a.id)}`,
})

/** Adds a `localId` to every paragraph that lacks one, as Jira may when it stores a description. */
function withLocalIds(node: unknown, next: () => string): unknown {
  if (Array.isArray(node)) return node.map((child) => withLocalIds(child, next))
  if (node === null || typeof node !== 'object') return node
  const copy = { ...(node as Record<string, unknown>) }
  if (copy.type === 'paragraph') {
    const attrs = (copy.attrs ?? {}) as Record<string, unknown>
    copy.attrs = { ...attrs, localId: attrs.localId ?? next() }
  }
  if (Array.isArray(copy.content)) copy.content = withLocalIds(copy.content, next)
  return copy
}

interface RawIssue {
  id: string
  key: string
  fields: RawFields
}

function issue(seed: Seed): RawIssue {
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
      priority: MEDIUM,
      duedate: null,
      timetracking:
        seed.estimate === undefined
          ? {}
          : { originalEstimateSeconds: seed.estimate, remainingEstimateSeconds: seed.estimate },
      [FIELDS.customer]: CUSTOMERS[seed.customer],
      [FIELDS.engagement]: ENGAGEMENTS[seed.engagement ?? 'north'],
      [FIELDS.sprint]: SPRINTS.filter((s) => s.id === seed.sprint),
      [FIELDS.startDate]: null,
      [FIELDS.timeRemaining]: seed.estimate === undefined ? null : seed.estimate / 3600,
      description: seed.rich
        ? structuredClone(RICH_DESCRIPTION)
        : seed.description === undefined
          ? null
          : {
              version: 1,
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: seed.description }] }],
            },
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
  /** Makes the next read of one issue answer 500. */
  failRead: () => void
  /** Makes the next issue edit answer 400, whatever it holds, so a test can watch an undo refused. */
  refuseNextEdit: () => void
  /** Removes an issue as if someone else deleted it: no hold and no count, so the next refetch loses it. */
  dropIssue: (key: string) => void
  /** Moves an issue to another status as if someone else did: no hold and no count, so the next refetch sees it. */
  moveIssue: (key: string, status: keyof typeof STATUSES) => void
  /** Lets the oldest held attachment upload proceed. The test waits for `counts.uploads` first. */
  releaseUpload: () => void
  /** Makes the next attachment upload answer 500 at once, without holding it. */
  failUpload: () => void
  /** Replaces an issue's description as if someone else did: no hold and no count. */
  setDescription: (key: string, description: unknown) => void
  /** Makes Jira store every saved description with a `localId` on each paragraph, as it may. */
  normaliseDescriptions: () => void
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
    issueReads: [],
    editBodies: [],
    uploads: [],
    openExternal: [],
    quitPrompts: 0,
    avatarFetches: [],
  }
  // Attachments by issue key. PSAPAC-1 starts with the image its description embeds.
  const attachments = new Map<string, Attachment[]>([
    [
      'PSAPAC-1',
      [
        {
          id: 5001,
          filename: 'diagram.png',
          mediaId: SEED_MEDIA_ID,
          mimeType: 'image/png',
          bytes: png(),
        },
      ],
    ],
  ])
  let uploaded = 0
  const heldUploads: (() => void)[] = []
  let failNextUpload = false
  let normalise = false
  let unresolvedComplete = false
  // Every write waits here, so a test sees the optimistic state with Jira's answer still pending.
  const held: (() => void)[] = []
  // The first Done page waits here, so a test sees the Tree before Done issues arrive.
  let releaseFirstDone!: () => void
  const firstDone = new Promise<void>((resolve) => {
    releaseFirstDone = resolve
  })
  let doneHeld = false
  let failNextDone = false
  let failNextRead = false
  let refuseNext = false
  // Each applied write moves `updated` on, so a read always shows the later copy.
  let clock = 0
  let created = 0
  let localIds = 0

  const find = (key: string) => issues.find((i) => i.key === key)
  const touch = (target: RawIssue) => {
    clock++
    target.fields.updated = new Date(Date.UTC(2026, 9, 3, 0, 0, clock)).toISOString()
  }
  const refusal = (field: string, message: string) =>
    json({ errorMessages: [], errors: { [field]: message } }, 400)

  /** Parses a Jira duration with 8 hours to a day and 5 days to a week. */
  const seconds = (text: string) =>
    text
      .split(' ')
      .reduce(
        (sum, part) =>
          sum +
          Number.parseInt(part, 10) *
            { w: 144000, d: 28800, h: 3600, m: 60 }[part.slice(-1) as 'w'],
        0,
      )

  /** An issue as a read of one returns it: with the description and the subtasks. */
  const detail = (target: RawIssue) => ({
    ...target,
    fields: {
      ...target.fields,
      subtasks: issues
        .filter((i) => i.fields.parent?.key === target.key && i.fields.issuetype.subtask)
        .map((i) => ({
          key: i.key,
          fields: { summary: i.fields.summary, status: { name: i.fields.status.name } },
        })),
    },
  })

  function applyEdit(target: RawIssue, body: EditBody): Response | null {
    const { fields = {}, update = {} } = body
    if (refuseNext) {
      refuseNext = false
      return refusal('summary', 'The fake refuses this edit.')
    }
    if (typeof fields.summary === 'string' && fields.summary === REJECTED_SUMMARY) {
      return refusal('summary', 'The fake refuses this summary.')
    }
    const priority = fields.priority as { id: string } | undefined
    const chosen = PRIORITIES.find((p) => p.id === priority?.id)
    if (chosen?.name === REJECTED_PRIORITY) {
      return refusal('priority', 'The fake refuses this priority.')
    }
    if (typeof fields.summary === 'string') target.fields.summary = fields.summary
    if ('assignee' in fields) {
      const account = (fields.assignee as { accountId: string } | null)?.accountId
      target.fields.assignee =
        account === undefined
          ? null
          : (Object.values(USERS).find((u) => u.accountId === account) ?? null)
    }
    if (chosen !== undefined) target.fields.priority = chosen
    if ('duedate' in fields) target.fields.duedate = fields.duedate as string | null
    if (FIELDS.startDate in fields) target.fields[FIELDS.startDate] = fields[FIELDS.startDate]
    if (FIELDS.timeRemaining in fields)
      target.fields[FIELDS.timeRemaining] = fields[FIELDS.timeRemaining]
    if ('parent' in fields) {
      target.fields.parent = fields.parent as { key: string }
    }
    if ('description' in fields) {
      target.fields.description = normalise
        ? withLocalIds(fields.description, () => `n${String(++localIds)}`)
        : fields.description
    }
    const customer = Object.values(CUSTOMERS).find(
      (c) => c.id === (fields[FIELDS.customer] as { id: string } | undefined)?.id,
    )
    if (customer !== undefined) target.fields[FIELDS.customer] = customer
    const engagement = Object.values(ENGAGEMENTS).find(
      (e) => e.id === (fields[FIELDS.engagement] as { id: string } | undefined)?.id,
    )
    if (engagement !== undefined) target.fields[FIELDS.engagement] = engagement
    const type = Object.values(TYPES).find(
      (t) => t.name === (fields.issuetype as { name: string } | undefined)?.name,
    )
    if (type !== undefined) target.fields.issuetype = type
    for (const op of update.labels ?? []) {
      if ('add' in op && !target.fields.labels.includes(op.add)) target.fields.labels.push(op.add)
      if ('remove' in op) target.fields.labels = target.fields.labels.filter((l) => l !== op.remove)
    }
    const estimate = update.timetracking?.[0]?.edit.originalEstimate
    if (estimate !== undefined) {
      // As the live PSAPAC rules do: the remaining estimate follows, and Time remaining (h) with it.
      const total = seconds(estimate)
      target.fields.timetracking = {
        originalEstimateSeconds: total,
        remainingEstimateSeconds: total,
      }
      target.fields[FIELDS.timeRemaining] = total / 3600
    }
    touch(target)
    return null
  }

  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.origin === AVATAR_HOST) {
      const authorized = new Headers(init?.headers).has('authorization')
      counts.avatarFetches.push({ url: url.href, authorized })
      return url.pathname === '/u1/48'
        ? new Response(AVATAR_PNG, { headers: { 'content-type': 'image/png' } })
        : new Response(null, { status: 404 })
    }
    if (url.origin !== FAKE_SITE) throw new Error(`The e2e fake refuses ${url.origin}.`)
    const method = (init?.method ?? 'GET').toUpperCase()
    const auth = new Headers(init?.headers).get('authorization')
    const expected = `Basic ${Buffer.from(`me@example.com:${FAKE_TOKEN}`).toString('base64')}`
    if (auth !== expected) return json({ errorMessages: ['Bad credentials.'] }, 401)

    const path = url.pathname
    const body = (): unknown => JSON.parse(typeof init?.body === 'string' ? init.body : '{}')
    /** Holds a write until the test releases it, counting it on arrival. */
    const hold = async (received: unknown) => {
      counts.edits++
      counts.editBodies.push(received)
      await new Promise<void>((resolve) => held.push(resolve))
    }

    if (method === 'GET' && path === '/rest/api/3/myself') {
      return json(USERS.u1)
    }
    if (method === 'GET' && path === '/rest/api/3/issue/createmeta/PSAPAC/issuetypes') {
      const issueTypes = Object.values(TYPES).map(({ id, name }) => ({ id, name }))
      return json({ total: issueTypes.length, issueTypes })
    }
    if (
      method === 'GET' &&
      /^\/rest\/api\/3\/issue\/createmeta\/PSAPAC\/issuetypes\/\d+$/.test(path)
    ) {
      const names = ['Customer', 'Engagement', 'Sprint', 'Start date', 'Time remaining (h)']
      const allowed: Record<string, unknown> = {
        [FIELDS.customer]: Object.values(CUSTOMERS),
        [FIELDS.engagement]: Object.values(ENGAGEMENTS),
      }
      const fields = [
        ...Object.values(FIELDS).map((key, i) => ({
          key,
          name: names[i],
          ...(allowed[key] === undefined ? {} : { allowedValues: allowed[key] }),
        })),
        { key: 'priority', name: 'Priority', allowedValues: PRIORITIES },
      ]
      return json({ total: fields.length, fields })
    }
    if (method === 'POST' && path === '/rest/api/3/search/jql') {
      const search = body() as { jql: string; maxResults: number; nextPageToken?: string }
      // "!= Done" holds "= Done" as a substring, so test it first.
      const phase = search.jql.includes('statusCategory != Done') ? 'unresolved' : 'done'
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
      const start = Number(search.nextPageToken ?? '0')
      const end = start + search.maxResults
      if (phase === 'unresolved' && end >= matching.length) unresolvedComplete = true
      return json({
        issues: matching.slice(start, end),
        isLast: end >= matching.length,
        nextPageToken: String(end),
      })
    }

    if (method === 'GET' && path === '/rest/api/3/user/assignable/search') {
      const query = (url.searchParams.get('query') ?? '').toLowerCase()
      return json(
        Object.values(USERS)
          .filter((u) => u.displayName.toLowerCase().includes(query))
          .map((u) => ({ ...u, active: true })),
      )
    }

    if (method === 'GET' && path === '/rest/agile/1.0/board') {
      return json({ values: [{ id: BOARD_ID, name: 'PSAPAC board', type: 'scrum' }] })
    }
    if (method === 'GET' && path === `/rest/agile/1.0/board/${String(BOARD_ID)}/sprint`) {
      const states = url.searchParams.get('state')?.split(',')
      const values = SPRINTS.filter((s) => states === undefined || states.includes(s.state))
      return json({ total: values.length, values })
    }
    const sprintMove = /^\/rest\/agile\/1\.0\/sprint\/(\d+)\/issue$/.exec(path)
    if (method === 'POST' && (sprintMove !== null || path === '/rest/agile/1.0/backlog/issue')) {
      const moved = body() as { issues: string[] }
      await hold(moved)
      const sprint = SPRINTS.find((s) => String(s.id) === sprintMove?.[1])
      for (const key of moved.issues) {
        const target = find(key)
        if (target === undefined) continue
        const closed = (target.fields[FIELDS.sprint] as { state: string }[]).filter(
          (s) => s.state === 'closed',
        )
        target.fields[FIELDS.sprint] = [...closed, ...(sprint === undefined ? [] : [sprint])]
        touch(target)
      }
      counts.applied++
      return new Response(null, { status: 204 })
    }

    const transitions = /^\/rest\/api\/3\/issue\/(PSAPAC-\d+)\/transitions$/.exec(path)
    if (transitions !== null) {
      const target = find(transitions[1] ?? '')
      if (target === undefined) return json({ errorMessages: ['Issue does not exist.'] }, 404)
      // Transition ids differ from status ids, as they do in the real project.
      const open = Object.values(STATUSES).filter((s) => s.id !== target.fields.status.id)
      if (method === 'GET') {
        return json({
          transitions: open.map((to) => ({ id: `t${to.id}`, name: `Go to ${to.name}`, to })),
        })
      }
      if (method === 'POST') {
        const move = body() as { transition: { id: string } }
        await hold(move)
        const to = open.find((s) => `t${s.id}` === move.transition.id)
        if (to === undefined) return json({ errorMessages: ['No such transition.'] }, 400)
        target.fields.status = to
        touch(target)
        counts.applied++
        return new Response(null, { status: 204 })
      }
    }

    if (method === 'POST' && path === '/rest/api/3/issue') {
      const create = body() as CreateBody
      const fields = create.fields ?? {}
      const typeName = (fields.issuetype as { name: string } | undefined)?.name
      const typeKey = (Object.keys(TYPES) as (keyof typeof TYPES)[]).find(
        (k) => TYPES[k].name === typeName,
      )
      const customer = Object.values(CUSTOMERS).find(
        (c) => c.id === (fields[FIELDS.customer] as { id: string } | undefined)?.id,
      )
      const engagement = Object.values(ENGAGEMENTS).find(
        (e) => e.id === (fields[FIELDS.engagement] as { id: string } | undefined)?.id,
      )
      const summary = fields.summary
      if (typeKey === undefined || typeof summary !== 'string' || summary === '') {
        return refusal('summary', 'The fake needs a type and a summary.')
      }
      if (customer === undefined) return refusal(FIELDS.customer, 'Customer is required.')
      if (engagement === undefined) return refusal(FIELDS.engagement, 'Engagement is required.')
      if (TYPES[typeKey].subtask && fields.parent === undefined) {
        return refusal('parent', 'A Subtask needs a parent.')
      }
      if (summary === REJECTED_SUMMARY) {
        return refusal('summary', 'The fake refuses this summary.')
      }
      await hold(create)
      const raw = issue({
        n: FIRST_CREATED + created,
        summary,
        type: typeKey,
        status: 'todo',
        customer: 'acme',
      })
      created++
      const assignee = Object.values(USERS).find(
        (u) => u.accountId === (fields.assignee as { accountId: string } | undefined)?.accountId,
      )
      const priority = PRIORITIES.find(
        (p) => p.id === (fields.priority as { id: string } | undefined)?.id,
      )
      const estimate = (fields.timetracking as { originalEstimate?: string } | undefined)
        ?.originalEstimate
      Object.assign(raw.fields, {
        [FIELDS.customer]: customer,
        [FIELDS.engagement]: engagement,
        parent: (fields.parent as { key: string } | undefined) ?? null,
        assignee: assignee ?? null,
        priority: priority ?? MEDIUM,
        labels: [...((fields.labels as string[] | undefined) ?? [])],
        ...(estimate === undefined
          ? {}
          : {
              timetracking: {
                originalEstimateSeconds: seconds(estimate),
                remainingEstimateSeconds: seconds(estimate),
              },
            }),
      })
      // The live PSAPAC automation rewrites every new issue: it labels it, sets a 4h original
      // estimate with nothing remaining, and on a Task also replaces the Customer, the parent and
      // the sprint the request sent (handover Traps, T2 on 2026-10-08).
      const automate = () => {
        raw.fields.labels.push('PSAPAC')
        raw.fields.timetracking = { originalEstimateSeconds: 14400, remainingEstimateSeconds: 0 }
        raw.fields[FIELDS.timeRemaining] = 0
        if (typeKey === 'task') {
          raw.fields[FIELDS.customer] = CUSTOMERS.internal
          raw.fields.parent = { key: 'PSAPAC-50' }
          raw.fields[FIELDS.sprint] = SPRINTS.filter((s) => s.id === 5)
        }
      }
      if (options.lateAutomationMs === undefined) automate()
      else setTimeout(automate, options.lateAutomationMs)
      issues.push(raw)
      counts.applied++
      return json({ id: raw.id, key: raw.key }, 201)
    }

    const deletion = /^\/rest\/api\/3\/issue\/(PSAPAC-\d+)$/.exec(path)
    if (method === 'DELETE' && deletion !== null) {
      const target = find(deletion[1] ?? '')
      if (target === undefined) return json({ errorMessages: ['Issue does not exist.'] }, 404)
      const cascade = url.searchParams.get('deleteSubtasks') === 'true'
      const subtasks = issues.filter(
        (i) => i.fields.parent?.key === target.key && i.fields.issuetype.subtask,
      )
      if (subtasks.length > 0 && !cascade) {
        return json({ errorMessages: ['The issue has subtasks.'] }, 400)
      }
      await hold({ delete: target.key, deleteSubtasks: cascade })
      if (target.key === REJECTED_DELETE) {
        return json({ errorMessages: ['You cannot delete this issue.'] }, 403)
      }
      for (const gone of [target, ...(cascade ? subtasks : [])]) {
        issues.splice(issues.indexOf(gone), 1)
      }
      // As Jira does for an Epic: the child issues stay, without a parent.
      for (const child of issues) {
        if (child.fields.parent?.key === target.key) child.fields.parent = null
      }
      counts.applied++
      return new Response(null, { status: 204 })
    }

    if (method === 'GET' && path === '/rest/api/3/attachment/meta') {
      return json({ enabled: true, uploadLimit: 100_000_000 })
    }
    const upload = /^\/rest\/api\/3\/issue\/(PSAPAC-\d+)\/attachments$/.exec(path)
    if (method === 'POST' && upload !== null) {
      const target = find(upload[1] ?? '')
      if (target === undefined) return json({ errorMessages: ['Issue does not exist.'] }, 404)
      const file = (init?.body as FormData).get('file') as File
      counts.uploads.push({
        key: target.key,
        filename: file.name,
        type: file.type,
        size: file.size,
      })
      if (failNextUpload) {
        failNextUpload = false
        return json({ errorMessages: ['The fake failed this upload.'] }, 500)
      }
      await new Promise<void>((resolve) => heldUploads.push(resolve))
      const id = FIRST_UPLOADED + uploaded++
      const stored: Attachment = {
        id,
        filename: file.name,
        mediaId: mediaIdOf(id),
        mimeType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      }
      attachments.set(target.key, [...(attachments.get(target.key) ?? []), stored])
      return json([rawAttachment(stored)])
    }
    const content = /^\/rest\/api\/3\/attachment\/content\/(\d+)$/.exec(path)
    if (method === 'GET' && content !== null) {
      const found = [...attachments.values()].flat().find((a) => String(a.id) === content[1])
      if (found === undefined) return json({ errorMessages: ['No such attachment.'] }, 404)
      if (url.searchParams.get('redirect') === 'false') {
        return new Response(new Uint8Array(found.bytes), {
          headers: { 'content-type': found.mimeType },
        })
      }
      // Jira redirects to the media service, with the file id in the path and a token the real
      // one adds and this does not.
      return new Response(null, {
        status: 303,
        headers: {
          Location: `https://api.media.atlassian.com/file/${found.mediaId}/binary?client=fake&dl=true&name=${encodeURIComponent(found.filename)}`,
        },
      })
    }

    const one = /^\/rest\/api\/3\/issue\/(PSAPAC-\d+)$/.exec(path)
    if (method === 'GET' && one !== null && url.searchParams.get('fields') === 'attachment') {
      const target = find(one[1] ?? '')
      if (target === undefined) return json({ errorMessages: ['Issue does not exist.'] }, 404)
      return json({
        key: target.key,
        fields: { attachment: (attachments.get(target.key) ?? []).map(rawAttachment) },
      })
    }
    if (method === 'GET' && one !== null) {
      const target = find(one[1] ?? '')
      if (target === undefined) return json({ errorMessages: ['Issue does not exist.'] }, 404)
      counts.issueReads.push(target.key)
      if (failNextRead) {
        failNextRead = false
        return json({ errorMessages: ['The fake failed this read.'] }, 500)
      }
      return json(detail(target))
    }
    if (method === 'PUT' && one !== null) {
      const edit = body() as EditBody
      const target = find(one[1] ?? '')
      if (target === undefined) return json({ errorMessages: ['Issue does not exist.'] }, 404)
      await hold(edit)
      const refused = applyEdit(target, edit)
      if (refused !== null) return refused
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
    failRead: () => {
      failNextRead = true
    },
    refuseNextEdit: () => {
      refuseNext = true
    },
    dropIssue: (key) => {
      const target = find(key)
      if (target !== undefined) issues.splice(issues.indexOf(target), 1)
    },
    moveIssue: (key, status) => {
      const target = find(key)
      if (target === undefined) return
      target.fields.status = STATUSES[status]
      touch(target)
    },
    releaseUpload: () => {
      heldUploads.shift()?.()
    },
    failUpload: () => {
      failNextUpload = true
    },
    setDescription: (key, description) => {
      const target = find(key)
      if (target === undefined) return
      target.fields.description = description
      touch(target)
    },
    normaliseDescriptions: () => {
      normalise = true
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
