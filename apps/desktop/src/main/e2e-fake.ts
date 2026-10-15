import { createKeychain, type Keychain, type SecurityRunner } from '@jira-mgr/core/auth'

/**
 * Test doubles for the e2e entry: a Jira that answers from memory and a Keychain that never
 * runs `/usr/bin/security`. Core still runs for real on top of them.
 */

export const FAKE_SITE = 'https://fake.atlassian.net'
export const FAKE_TOKEN = 'good-token'
/** A summary the fake Jira refuses, so a test can watch an optimistic edit roll back. */
export const REJECTED_SUMMARY = 'reject me'
/** A create with this summary lands in the fake, but the reply is a 500, as a lost response looks to the app. */
export const LOST_SUMMARY = 'lose reply'
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
  /** The default file name each stand-in save dialog offered, in order. */
  downloads: string[]
  /** Every `text ~` search, in order of arrival, with whether the app aborted it. */
  textSearches: { query: string; aborted: boolean }[]
  /** Every timer reminder, as the e2e entry's stand-in for a native notification saw it. */
  notifications: { title: string; body: string }[]
  /** The Inbox's search, and each changelog and newest-comment read it made, as path and query. */
  inbox: { searches: number; reads: string[] }
  /** Every bulk POST received, in order, as its path and body. Bulk calls are not held. */
  bulk: { path: string; body: unknown }[]
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

/** Not in `STATUSES`, so no picker or transition list offers it; only `moveIssue` puts an issue here. */
const HOLD = { id: '4', name: 'Hold', statusCategory: { key: 'new' } } as const

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
  {
    id: 5,
    name: 'Sprint 5',
    state: 'active',
    startDate: '2026-10-01T00:00:00.000Z',
    endDate: '2026-10-14T00:00:00.000Z',
    goal: 'Ship the onboarding flow',
  },
  { id: 6, name: 'Sprint 6', state: 'future', startDate: '2026-10-15T00:00:00.000Z' },
  { id: 7, name: 'PS TEMPLATES', state: 'future' },
]

const BOARD_ID = 7

const ME = { accountId: 'u1', displayName: 'Test User' }
const OTHER = { accountId: 'u2', displayName: 'Other User' }

/** A few of the site's link types: the five Q19 puts first, and three that sit below the divider. */
const LINK_TYPES = [
  { id: '1', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
  { id: '2', name: 'Relates', inward: 'relates to', outward: 'relates to' },
  { id: '3', name: 'Duplicate', inward: 'is duplicated by', outward: 'duplicates' },
  { id: '4', name: 'Causes', inward: 'is caused by', outward: 'causes' },
  { id: '5', name: 'Cloners', inward: 'is cloned by', outward: 'clones' },
  { id: '6', name: 'Polaris datapoint', inward: 'is idea for', outward: 'implements' },
  { id: '7', name: 'Problem/Incident', inward: 'is caused by', outward: 'causes' },
  { id: '8', name: 'Test', inward: 'is tested by', outward: 'tests' },
]

/** A document of one paragraph. */
const doc = (text: string) => ({
  version: 1,
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

interface Comment {
  id: number
  author: typeof ME
  body: unknown
  created: string
  updated: string
}

/** One field of a changelog history, as Jira's changelog endpoint sends it. */
export interface InboxItem {
  field: string
  fromString: string | null
  toString: string | null
}

interface History {
  id: string
  created: string
  author: typeof ME
  items: InboxItem[]
}

interface Worklog {
  id: number
  author: typeof ME
  seconds: number
  started: string
  comment: unknown
  created: string
  updated: string
}

/** A link as Jira stores it: `blocker` is the POST's `inwardIssue`, `blocked` its `outwardIssue`. */
interface StoredLink {
  id: number
  typeId: string
  blocker: string
  blocked: string
}

const FIRST_COMMENT = 8000
const FIRST_WORKLOG = 7000
const FIRST_LINK = 9000

interface Seed {
  n: number
  summary: string
  type: keyof typeof TYPES
  status: keyof typeof STATUSES
  parent?: number
  customer: keyof typeof CUSTOMERS
  engagement?: keyof typeof ENGAGEMENTS
  assignee?: keyof typeof USERS
  /** Who created the issue. Defaults to u1, the signed-in user. */
  creator?: keyof typeof USERS
  /** The due date, as Jira sends it. */
  due?: string
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
    creator: 'u2',
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
    due: '2998-06-01',
  },
  {
    n: 22,
    summary: 'Migrate the schema',
    type: 'story',
    status: 'done',
    parent: 20,
    customer: 'beta',
    due: '2020-01-02',
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
    creator: 'u2',
    due: '2999-12-31',
  },
  {
    n: 32,
    summary: 'Review the report layout',
    type: 'story',
    status: 'todo',
    parent: 30,
    customer: 'beta',
    assignee: 'u2',
    creator: 'u2',
  },
  {
    n: 40,
    summary: 'Tidy the wiki',
    type: 'story',
    status: 'todo',
    customer: 'beta',
    due: '2020-01-02',
  },
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
  status: (typeof STATUSES)[keyof typeof STATUSES] | typeof HOLD
  labels: string[]
  updated: string
  assignee: (typeof USERS)[keyof typeof USERS] | null
  creator: (typeof USERS)[keyof typeof USERS]
  parent: { key: string } | null
  priority: (typeof PRIORITIES)[number]
  duedate: string | null
  timetracking: {
    originalEstimateSeconds?: number
    remainingEstimateSeconds?: number
    timeSpentSeconds?: number
  }
  description: unknown
  /** The custom fields, by the ids in `FIELDS`. */
  [field: string]: unknown
}

/** The body of an issue create, as far as the fake reads it. */
interface CreateBody {
  fields?: Record<string, unknown>
}

/** The body of a bulk transition or bulk field edit, as far as the fake reads it. */
interface BulkBody {
  bulkTransitionInputs?: { selectedIssueIdsOrKeys: string[]; transitionId: string }[]
  selectedIssueIdsOrKeys?: string[]
  editedFieldsInput?: {
    priority?: { priorityId: string }
    singleSelectClearableUserPickerFields?: { user: { accountId: string } | null }[]
    labelsFields?: { labels: { name: string }[] }[]
    singleSelectFields?: { fieldId: string; option: { optionId: number } }[]
  }
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
  author: { accountId: 'u1', displayName: 'Test User' },
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
      creator: USERS[seed.creator ?? 'u1'],
      parent: seed.parent === undefined ? null : { key: `PSAPAC-${String(seed.parent)}` },
      priority: MEDIUM,
      duedate: seed.due ?? null,
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

/** The `text ~ "..."` clause of core's text search, its quoted string captured. */
const TEXT_CLAUSE = /text ~ "((?:[^"\\]|\\.)*)"/

/** Undoes JQL quoting and then Lucene escaping, which core applies one after the other. */
const unescapeJql = (quoted: string) => quoted.replace(/\\(.)/g, '$1').replace(/\\(.)/g, '$1')

/** The text nodes of an ADF document, joined by spaces. */
function adfText(node: unknown): string {
  if (typeof node !== 'object' || node === null) return ''
  const { text, content } = node as { text?: unknown; content?: unknown }
  const own = typeof text === 'string' ? text : ''
  return Array.isArray(content) ? [own, ...content.map(adfText)].join(' ') : own
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
  /** Lets the newest held edit proceed, as a network may answer a later request first. */
  releaseNewestEdit: () => void
  /** The fields of an issue as the fake holds them, or `undefined` when it has no such issue. */
  fieldsOf: (key: string) => RawFields | undefined
  /** Lets the first Done page proceed. Until then no Done issue has loaded, with no timing window. */
  releaseDone: () => void
  /** Makes the next Done page answer 500. */
  failDone: () => void
  /** Makes the next open-issues search page answer 500. */
  failUnresolved: () => void
  /** Holds every open-issues search page until `releaseUnresolved`, so no open issue loads. */
  holdUnresolved: () => void
  releaseUnresolved: () => void
  /** Makes the next read of one issue answer 500. */
  failRead: () => void
  /** Makes the next read of an issue's transitions answer 500. */
  failTransitions: () => void
  /** Makes the next read of any issue's comments answer `status`. */
  failComments: (status: 404 | 500) => void
  /** Holds each `text ~` search until `releaseTextSearch` or until the app aborts it. */
  holdTextSearch: () => void
  /** Answers the held text searches and stops holding. */
  releaseTextSearch: () => void
  /** Makes the next issue edit answer 400, whatever it holds, so a test can watch an undo refused. */
  refuseNextEdit: () => void
  /** Makes the next bulk POST answer 400, so core runs the batch one issue at a time. */
  refuseNextBulk: () => void
  /** Makes every write to these issues fail: a bulk task lists them as failed and a single write answers 400. */
  refuseKeys: (keys: string[]) => void
  /** Removes an issue as if someone else deleted it: no hold and no count, so the next refetch loses it. */
  dropIssue: (key: string) => void
  /** Moves an issue to another status as if someone else did: no hold and no count, so the next refetch sees it. */
  moveIssue: (key: string, status: keyof typeof STATUSES | 'hold') => void
  /** Lets the oldest held attachment upload proceed. The test waits for `counts.uploads` first. */
  releaseUpload: () => void
  /** Makes the next attachment upload answer 500 at once, without holding it. */
  failUpload: () => void
  /** Replaces an issue's description as if someone else did: no hold and no count. */
  setDescription: (key: string, description: unknown) => void
  /** Puts issues into a sprint as if someone else did: no hold and no count. */
  joinSprint: (keys: string[], sprintId: number) => void
  /** Makes Jira store every saved description with a `localId` on each paragraph, as it may. */
  normaliseDescriptions: () => void
  /** Replaces a comment's body as if someone else edited it: no hold and no count. */
  setComment: (key: string, id: number, body: unknown) => void
  /** Removes a comment as if someone else deleted it: no hold and no count. */
  removeComment: (key: string, id: number) => void
  /** Adds a worklog by the signed-in user, with this comment document, before a test opens the page. */
  addWorklog: (key: string, comment: unknown) => void
  /** Adds a worklog of `seconds` that started at the ISO time `started`, by the signed-in user, with no hold and no count. */
  logWork: (key: string, started: string, seconds: number) => void
  /** Sets the original estimate in seconds, or clears it with `null`, as if someone else did: no hold and no count. */
  setEstimate: (key: string, estimate: number | null) => void
  /** Holds each comment and link list read from now on, until `releaseReads`. */
  holdReads: () => void
  /** Answers every held list read, and stops holding. */
  releaseReads: () => void
  /**
   * Adds the issue to the Inbox's search and records one changelog history on it, made by the
   * signed-in user or by someone else, moving the issue's `updated` on.
   */
  inboxChange: (key: string, by: 'me' | 'other', items: InboxItem[]) => void
  /** Adds the issue to the Inbox's search and a comment on it, moving the issue's `updated` on. */
  inboxComment: (key: string, by: 'me' | 'other') => void
  /** Adds the issue to the Inbox's search with no change. */
  inboxWatch: (key: string) => void
  /** Makes the stand-in save dialog answer "cancelled" the next time it opens. */
  cancelNextDownload: () => void
  /** Reads and clears the cancel request. The e2e entry's save dialog calls it. */
  takeDownloadCancel: () => boolean
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
    downloads: [],
    textSearches: [],
    notifications: [],
    inbox: { searches: 0, reads: [] },
    bulk: [],
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
        {
          id: 5002,
          filename: 'report.xlsx',
          mediaId: mediaIdOf(5002),
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          bytes: new TextEncoder().encode('xlsx-bytes'),
        },
      ],
    ],
  ])
  const comments = new Map<string, Comment[]>([
    [
      'PSAPAC-1',
      [
        {
          id: 7900,
          author: ME,
          body: doc('My first comment'),
          created: '2026-10-02T01:00:00.000Z',
          updated: '2026-10-02T01:00:00.000Z',
        },
        {
          id: 7901,
          author: OTHER,
          body: doc('A comment by someone else'),
          created: '2026-10-02T02:00:00.000Z',
          updated: '2026-10-02T02:00:00.000Z',
        },
      ],
    ],
  ])
  const worklogs = new Map<string, Worklog[]>([
    [
      'PSAPAC-2',
      [
        {
          id: 6900,
          author: ME,
          seconds: 3600,
          started: '2026-10-02T03:00:00.000Z',
          comment: doc('Set up the model'),
          created: '2026-10-02T03:00:00.000Z',
          updated: '2026-10-02T03:00:00.000Z',
        },
        {
          id: 6901,
          author: OTHER,
          seconds: 1800,
          started: '2026-10-02T04:00:00.000Z',
          comment: null,
          created: '2026-10-02T04:00:00.000Z',
          updated: '2026-10-02T04:00:00.000Z',
        },
      ],
    ],
  ])
  const links: StoredLink[] = [
    { id: 9900, typeId: '1', blocker: 'PSAPAC-1', blocked: 'PSAPAC-2' },
    { id: 9901, typeId: '2', blocker: 'PSAPAC-3', blocked: 'PSAPAC-1' },
  ]
  let commentIds = 0
  // The Inbox: the issues its search returns, and the changelog of each.
  const inboxKeys = new Set<string>()
  // The Inbox forgets read marks older than 14 days by the real clock, so its changes are recent.
  let inboxTick = 0
  const recently = () => new Date(Date.now() - 3_600_000 + ++inboxTick * 1000).toISOString()
  const histories = new Map<string, History[]>()
  let worklogIds = 0
  let linkIds = 0
  let cancelDownload = false
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
  let failNextUnresolved = false
  let unresolvedGate: Promise<void> | null = null
  let releaseUnresolvedGate: () => void = () => undefined
  let failNextRead = false
  let failNextTransitions = false
  let failNextComments: 404 | 500 | null = null
  let refuseNext = false
  let refuseBulkNext = false
  const refusedKeys = new Set<string>()
  /** The bulk tasks submitted, by id: the issue ids Jira processed and the ones it failed. */
  const tasks = new Map<string, { processed: number[]; failed: Record<string, string[]> }>()
  let textHeld = false
  const heldText: (() => void)[] = []
  let readsHeld = false
  const heldReads: (() => void)[] = []
  /** Waits while `holdReads` is on, so a test sees the page before a refetch lands. */
  const holdRead = async () => {
    if (readsHeld) await new Promise<void>((resolve) => heldReads.push(resolve))
  }
  // Each applied write moves `updated` on, so a read always shows the later copy.
  let clock = 0
  let created = 0
  let localIds = 0

  const find = (key: string) => issues.find((i) => i.key === key)
  const touch = (target: RawIssue) => {
    clock++
    target.fields.updated = new Date(Date.UTC(2026, 9, 3, 0, 0, clock)).toISOString()
  }
  /** Jira sums an issue's worklogs into `timetracking.timeSpentSeconds`, and sends none while it is 0. */
  const syncSpent = (target: RawIssue) => {
    const total = (worklogs.get(target.key) ?? []).reduce((sum, w) => sum + w.seconds, 0)
    if (total > 0) target.fields.timetracking.timeSpentSeconds = total
    else delete target.fields.timetracking.timeSpentSeconds
  }
  for (const target of issues) syncSpent(target)
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
  /** The links of an issue as a search carries them, seen from that issue. */
  const issuelinksOf = (key: string) =>
    links
      .filter((l) => l.blocker === key || l.blocked === key)
      .map((l) => {
        const other = issues.find((i) => i.key === (l.blocker === key ? l.blocked : l.blocker))
        const end = {
          key: other?.key ?? '',
          fields: {
            summary: other?.fields.summary ?? '',
            status: other?.fields.status ?? { name: '' },
          },
        }
        return {
          id: String(l.id),
          type: LINK_TYPES.find((t) => t.id === l.typeId),
          ...(l.blocker === key ? { outwardIssue: end } : { inwardIssue: end }),
        }
      })

  const withLinks = (target: RawIssue) => ({
    ...target,
    fields: { ...target.fields, issuelinks: issuelinksOf(target.key) },
  })

  const detail = (target: RawIssue) => ({
    ...target,
    fields: {
      ...target.fields,
      issuelinks: issuelinksOf(target.key),
      subtasks: issues
        .filter((i) => i.fields.parent?.key === target.key && i.fields.issuetype.subtask)
        .map((i) => ({
          key: i.key,
          fields: {
            summary: i.fields.summary,
            status: { name: i.fields.status.name, statusCategory: i.fields.status.statusCategory },
          },
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
        ...target.fields.timetracking,
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

    if (method === 'GET' && path === '/rest/api/3/configuration') {
      return json({
        timeTrackingEnabled: true,
        timeTrackingConfiguration: {
          workingHoursPerDay: 8,
          workingDaysPerWeek: 5,
          timeFormat: 'pretty',
          defaultUnit: 'minute',
        },
      })
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
      if (search.jql.includes('currentUser()')) {
        counts.inbox.searches++
        const found = issues
          .filter((i) => inboxKeys.has(i.key))
          .sort((a, b) => Date.parse(b.fields.updated) - Date.parse(a.fields.updated))
        return json({ issues: found.slice(0, search.maxResults), isLast: true })
      }
      const textClause = TEXT_CLAUSE.exec(search.jql)
      if (textClause !== null) {
        const entry = { query: unescapeJql(textClause[1] ?? ''), aborted: false }
        counts.textSearches.push(entry)
        const signal = init?.signal ?? undefined
        signal?.addEventListener('abort', () => {
          entry.aborted = true
        })
        if (textHeld) {
          await new Promise<void>((resolve, reject) => {
            heldText.push(resolve)
            signal?.addEventListener('abort', () => {
              reject(signal.reason as Error)
            })
          })
        }
        const words = entry.query
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w !== '')
        const found = issues
          .filter((i) => {
            const haystack = [
              i.fields.summary,
              adfText(i.fields.description),
              ...(comments.get(i.key) ?? []).map((c) => adfText(c.body)),
            ]
              .join(' ')
              .toLowerCase()
            return words.every((w) => haystack.includes(w))
          })
          .sort((a, b) => Date.parse(b.fields.updated) - Date.parse(a.fields.updated))
        return json({ issues: found.slice(0, search.maxResults).map(withLinks), isLast: true })
      }
      // "!= Done" holds "= Done" as a substring, so test it first.
      const phase = search.jql.includes('statusCategory != Done') ? 'unresolved' : 'done'
      if (phase === 'unresolved') {
        if (unresolvedGate !== null) await unresolvedGate
        if (failNextUnresolved) {
          failNextUnresolved = false
          return json({ errorMessages: ['The fake failed this page.'] }, 500)
        }
      }
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
        issues: matching.slice(start, end).map(withLinks),
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
    const sprintPath = /^\/rest\/agile\/1\.0\/sprint\/(\d+)(\/issue)?$/.exec(path)
    if (method === 'GET' && sprintPath !== null) {
      const sprint = SPRINTS.find((s) => String(s.id) === sprintPath[1])
      if (sprint === undefined) return json({ errorMessages: ['Sprint does not exist.'] }, 404)
      if (sprintPath[2] === undefined) return json(sprint)
      const inSprint = issues.filter((i) =>
        (i.fields[FIELDS.sprint] as { id: number }[]).some((s) => s.id === sprint.id),
      )
      const startAt = Number(url.searchParams.get('startAt') ?? '0')
      const maxResults = Number(url.searchParams.get('maxResults') ?? '50')
      return json({
        startAt,
        maxResults,
        total: inSprint.length,
        issues: inSprint.slice(startAt, startAt + maxResults),
      })
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

    // Jira's bulk endpoints: a submit answers a task id, and the queue answers the task's result.
    if (method === 'GET' && path === '/rest/api/3/bulk/issues/transition') {
      const keys = (url.searchParams.get('issueIdsOrKeys') ?? '').split(',')
      const targets = keys.flatMap((key) => find(key) ?? [])
      // The transitions common to every issue: a status none of them is in already.
      const common = Object.values(STATUSES).filter((s) =>
        targets.every((t) => t.fields.status.id !== s.id),
      )
      return json({
        availableTransitions: [
          {
            transitions: common.map((to) => ({
              transitionId: 100 + Number(to.id),
              transitionName: to.name,
              to: { statusId: Number(to.id), statusName: to.name },
            })),
            issues: targets.map((t) => t.key),
            isTransitionsFiltered: false,
          },
        ],
      })
    }
    const bulkSubmit = /^\/rest\/api\/3\/bulk\/issues\/(transition|fields)$/.exec(path)
    if (method === 'POST' && bulkSubmit !== null) {
      if (refuseBulkNext) {
        refuseBulkNext = false
        return json({ errorMessages: ['The fake refuses this bulk call.'] }, 400)
      }
      const submitted = body() as BulkBody
      counts.bulk.push({ path, body: submitted })
      const processed: number[] = []
      const failed: Record<string, string[]> = {}
      const apply = (keys: string[], change: (target: RawIssue) => void) => {
        for (const key of keys) {
          const target = find(key)
          if (target === undefined) continue
          if (refusedKeys.has(key)) failed[target.id] = [`The fake refuses ${key}.`]
          else {
            change(target)
            touch(target)
            processed.push(Number(target.id))
          }
        }
      }
      if (bulkSubmit[1] === 'transition') {
        for (const input of submitted.bulkTransitionInputs ?? []) {
          const to = Object.values(STATUSES).find(
            (s) => 100 + Number(s.id) === Number(input.transitionId),
          )
          apply(input.selectedIssueIdsOrKeys, (target) => {
            if (to !== undefined) target.fields.status = to
          })
        }
      } else {
        const input = submitted.editedFieldsInput ?? {}
        apply(submitted.selectedIssueIdsOrKeys ?? [], (target) => {
          const priority = PRIORITIES.find((p) => p.id === input.priority?.priorityId)
          if (priority !== undefined) target.fields.priority = priority
          const user = input.singleSelectClearableUserPickerFields?.[0]
          if (user !== undefined) {
            target.fields.assignee =
              Object.values(USERS).find((u) => u.accountId === user.user?.accountId) ?? null
          }
          for (const { name } of input.labelsFields?.[0]?.labels ?? []) {
            if (!target.fields.labels.includes(name)) target.fields.labels.push(name)
          }
          for (const { fieldId, option } of input.singleSelectFields ?? []) {
            const options = fieldId === FIELDS.customer ? CUSTOMERS : ENGAGEMENTS
            const chosen = Object.values(options).find((o) => Number(o.id) === option.optionId)
            if (chosen !== undefined) target.fields[fieldId] = chosen
          }
        })
      }
      const taskId = String(9000 + tasks.size)
      tasks.set(taskId, { processed, failed })
      return json({ taskId })
    }
    const queued = /^\/rest\/api\/3\/bulk\/queue\/(\d+)$/.exec(path)
    if (method === 'GET' && queued !== null) {
      const task = tasks.get(queued[1] ?? '')
      if (task === undefined) return json({ errorMessages: ['No such task.'] }, 404)
      return json({
        taskId: queued[1],
        status: 'COMPLETE',
        processedAccessibleIssues: task.processed,
        failedAccessibleIssues: task.failed,
      })
    }

    const transitions = /^\/rest\/api\/3\/issue\/(PSAPAC-\d+)\/transitions$/.exec(path)
    if (transitions !== null) {
      const target = find(transitions[1] ?? '')
      if (target === undefined) return json({ errorMessages: ['Issue does not exist.'] }, 404)
      // Transition ids differ from status ids, as they do in the real project.
      const open = Object.values(STATUSES).filter((s) => s.id !== target.fields.status.id)
      if (method === 'GET') {
        if (failNextTransitions) {
          failNextTransitions = false
          return json({ errorMessages: ['The fake failed this lookup.'] }, 500)
        }
        return json({
          transitions: open.map((to) => ({ id: `t${to.id}`, name: `Go to ${to.name}`, to })),
        })
      }
      if (method === 'POST') {
        const move = body() as { transition: { id: string } }
        await hold(move)
        const to = open.find((s) => `t${s.id}` === move.transition.id)
        if (to === undefined || refusedKeys.has(target.key)) {
          return json({ errorMessages: [`No such transition for ${target.key}.`] }, 400)
        }
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
        duedate: (fields.duedate as string | undefined) ?? null,
        [FIELDS.startDate]: (fields[FIELDS.startDate] as string | undefined) ?? null,
        ...(fields.description === undefined ? {} : { description: fields.description }),
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
      if (summary === LOST_SUMMARY)
        return json({ errorMessages: ['The fake lost this reply.'] }, 500)
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

    // Comments, worklogs and links. Every write holds until `releaseEdit`, as an edit does.
    const stamp = () => new Date(Date.UTC(2026, 9, 3, 0, 0, ++clock)).toISOString()
    /** The refusal `refuseNextEdit` asked for, once. */
    const refusedWrite = () => {
      if (!refuseNext) return null
      refuseNext = false
      return refusal('body', 'The fake refuses this write.')
    }
    const missing = (what: string) => json({ errorMessages: [`${what} does not exist.`] }, 404)
    const changelog = /^\/rest\/api\/3\/issue\/(PSAPAC-\d+)\/changelog$/.exec(path)
    if (method === 'GET' && changelog !== null) {
      counts.inbox.reads.push(`${path}${url.search}`)
      const all = histories.get(changelog[1] ?? '') ?? []
      const startAt = Number(url.searchParams.get('startAt') ?? '0')
      const maxResults = Number(url.searchParams.get('maxResults') ?? '100')
      return json({
        startAt,
        maxResults,
        total: all.length,
        isLast: startAt + maxResults >= all.length,
        values: all.slice(startAt, startAt + maxResults),
      })
    }
    const commentCollection = /^\/rest\/api\/3\/issue\/(PSAPAC-\d+)\/comment(?:\/(\d+))?$/.exec(
      path,
    )
    if (commentCollection !== null) {
      const target = find(commentCollection[1] ?? '')
      if (target === undefined) return missing('Issue')
      const list = comments.get(target.key) ?? []
      const shownComment = (c: Comment) => ({ ...c, id: String(c.id) })
      const found = list.find((c) => String(c.id) === commentCollection[2])
      if (method === 'GET' && commentCollection[2] === undefined) {
        // The Inbox asks for the newest comment alone, and is never held with the page's reads.
        if (url.searchParams.get('orderBy') === '-created') {
          counts.inbox.reads.push(`${path}${url.search}`)
          const newest = [...list].sort((a, b) => Date.parse(b.created) - Date.parse(a.created))
          const count = Number(url.searchParams.get('maxResults') ?? list.length)
          return json({ total: list.length, comments: newest.slice(0, count).map(shownComment) })
        }
        if (failNextComments !== null) {
          const status = failNextComments
          failNextComments = null
          return json({ errorMessages: ['The fake failed this comments read.'] }, status)
        }
        await holdRead()
        return json({ total: list.length, comments: list.map(shownComment) })
      }
      if (method === 'POST' && commentCollection[2] === undefined) {
        const { body: text } = body() as { body: unknown }
        await hold({ comment: 'add', key: target.key, body: text })
        const refused = refusedWrite()
        if (refused !== null) return refused
        const now = stamp()
        const added: Comment = {
          id: FIRST_COMMENT + commentIds++,
          author: ME,
          body: text,
          created: now,
          updated: now,
        }
        comments.set(target.key, [...list, added])
        counts.applied++
        return json(shownComment(added), 201)
      }
      if (method === 'PUT' && found !== undefined) {
        const { body: text } = body() as { body: unknown }
        await hold({ comment: 'edit', key: target.key, id: found.id, body: text })
        const refused = refusedWrite()
        if (refused !== null) return refused
        found.body = text
        found.updated = stamp()
        counts.applied++
        return json(shownComment(found))
      }
      if (method === 'DELETE' && found !== undefined) {
        await hold({ comment: 'delete', key: target.key, id: found.id })
        const refused = refusedWrite()
        if (refused !== null) return refused
        comments.set(
          target.key,
          list.filter((c) => c !== found),
        )
        counts.applied++
        return new Response(null, { status: 204 })
      }
      if (commentCollection[2] !== undefined) return missing('Comment')
    }

    const worklogRoute = /^\/rest\/api\/3\/issue\/(PSAPAC-\d+)\/worklog(?:\/(\d+))?$/.exec(path)
    if (worklogRoute !== null) {
      const target = find(worklogRoute[1] ?? '')
      if (target === undefined) return missing('Issue')
      const list = worklogs.get(target.key) ?? []
      const found = list.find((w) => String(w.id) === worklogRoute[2])
      const shown = (w: Worklog) => ({
        id: String(w.id),
        author: w.author,
        timeSpent:
          w.seconds % 3600 === 0 ? `${String(w.seconds / 3600)}h` : `${String(w.seconds / 60)}m`,
        timeSpentSeconds: w.seconds,
        started: w.started,
        comment: w.comment,
        created: w.created,
        updated: w.updated,
      })
      /** `adjustEstimate=auto`: the remaining estimate, and Time remaining (h) with it, move by `delta`. */
      const adjust = (delta: number) => {
        const left = target.fields.timetracking.remainingEstimateSeconds
        if (left === undefined) return
        const next = Math.max(0, left + delta)
        target.fields.timetracking.remainingEstimateSeconds = next
        target.fields[FIELDS.timeRemaining] = next / 3600
        touch(target)
      }
      const adjusting = url.searchParams.get('adjustEstimate')
      if (method === 'GET' && worklogRoute[2] === undefined) {
        return json({ total: list.length, worklogs: list.map(shown) })
      }
      if (method === 'GET' && found !== undefined) return json(shown(found))
      if (method === 'POST' && worklogRoute[2] === undefined) {
        const input = body() as { timeSpent: string; started?: string; comment?: unknown }
        await hold({ worklog: 'add', key: target.key, adjustEstimate: adjusting, ...input })
        const refused = refusedWrite()
        if (refused !== null) return refused
        const now = stamp()
        const added: Worklog = {
          id: FIRST_WORKLOG + worklogIds++,
          author: ME,
          seconds: seconds(input.timeSpent),
          started: input.started ?? now,
          comment: input.comment ?? null,
          created: now,
          updated: now,
        }
        worklogs.set(target.key, [...list, added])
        syncSpent(target)
        if (adjusting === 'auto') adjust(-added.seconds)
        counts.applied++
        return json(shown(added), 201)
      }
      if (method === 'PUT' && found !== undefined) {
        const input = body() as { timeSpent?: string; started?: string; comment?: unknown }
        await hold({ worklog: 'edit', key: target.key, adjustEstimate: adjusting, ...input })
        const refused = refusedWrite()
        if (refused !== null) return refused
        const before = found.seconds
        if (input.timeSpent !== undefined) found.seconds = seconds(input.timeSpent)
        if (input.started !== undefined) found.started = input.started
        if (input.comment !== undefined) found.comment = input.comment
        found.updated = stamp()
        syncSpent(target)
        if (adjusting === 'auto') adjust(before - found.seconds)
        counts.applied++
        return json(shown(found))
      }
      if (method === 'DELETE' && found !== undefined) {
        await hold({ worklog: 'delete', key: target.key, adjustEstimate: adjusting, id: found.id })
        const refused = refusedWrite()
        if (refused !== null) return refused
        worklogs.set(
          target.key,
          list.filter((w) => w !== found),
        )
        syncSpent(target)
        if (adjusting === 'auto') adjust(found.seconds)
        counts.applied++
        return new Response(null, { status: 204 })
      }
      if (worklogRoute[2] !== undefined) return missing('Worklog')
    }

    if (method === 'GET' && path === '/rest/api/3/issueLinkType') {
      return json({ issueLinkTypes: LINK_TYPES })
    }
    if (method === 'POST' && path === '/rest/api/3/issueLink') {
      const input = body() as {
        type: { id?: string; name?: string }
        inwardIssue: { key: string }
        outwardIssue: { key: string }
      }
      const type = LINK_TYPES.find((t) => t.id === input.type.id || t.name === input.type.name)
      if (type === undefined) return refusal('type', 'No such link type.')
      if (find(input.inwardIssue.key) === undefined || find(input.outwardIssue.key) === undefined) {
        return missing('Issue')
      }
      await hold({ link: 'add', ...input })
      const refused = refusedWrite()
      if (refused !== null) return refused
      links.push({
        id: FIRST_LINK + linkIds++,
        typeId: type.id,
        blocker: input.inwardIssue.key,
        blocked: input.outwardIssue.key,
      })
      counts.applied++
      return new Response(null, { status: 201 })
    }
    const linkRoute = /^\/rest\/api\/3\/issueLink\/(\d+)$/.exec(path)
    if (linkRoute !== null) {
      const found = links.find((l) => String(l.id) === linkRoute[1])
      if (found === undefined) return missing('Link')
      if (method === 'GET') {
        return json({
          id: String(found.id),
          type: LINK_TYPES.find((t) => t.id === found.typeId),
          inwardIssue: { key: found.blocker },
          outwardIssue: { key: found.blocked },
        })
      }
      if (method === 'DELETE') {
        await hold({ link: 'remove', id: found.id })
        const refused = refusedWrite()
        if (refused !== null) return refused
        links.splice(links.indexOf(found), 1)
        counts.applied++
        return new Response(null, { status: 204 })
      }
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
    if (method === 'GET' && one !== null && url.searchParams.get('fields') === 'issuelinks') {
      const target = find(one[1] ?? '')
      if (target === undefined) return missing('Issue')
      await holdRead()
      // Seen from `target`: the link where it blocks lists the other as `outwardIssue`.
      const seen = (key: string) => {
        const other = find(key)
        return {
          key,
          fields: {
            summary: other?.fields.summary ?? '',
            status: { name: other?.fields.status.name ?? '' },
          },
        }
      }
      return json({
        key: target.key,
        fields: {
          issuelinks: links
            .filter((l) => l.blocker === target.key || l.blocked === target.key)
            .map((l) => ({
              id: String(l.id),
              type: LINK_TYPES.find((t) => t.id === l.typeId),
              ...(l.blocker === target.key
                ? { outwardIssue: seen(l.blocked) }
                : { inwardIssue: seen(l.blocker) }),
            })),
        },
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
      if (refusedKeys.has(target.key)) return refusal('summary', `The fake refuses ${target.key}.`)
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
    releaseNewestEdit: () => {
      held.pop()?.()
    },
    fieldsOf: (key) => find(key)?.fields,
    releaseDone: () => {
      releaseFirstDone()
    },
    failDone: () => {
      failNextDone = true
    },
    failUnresolved: () => {
      failNextUnresolved = true
    },
    holdUnresolved: () => {
      unresolvedGate = new Promise<void>((resolve) => {
        releaseUnresolvedGate = resolve
      })
    },
    releaseUnresolved: () => {
      releaseUnresolvedGate()
      unresolvedGate = null
    },
    failRead: () => {
      failNextRead = true
    },
    failTransitions: () => {
      failNextTransitions = true
    },
    failComments: (status) => {
      failNextComments = status
    },
    holdTextSearch: () => {
      textHeld = true
    },
    releaseTextSearch: () => {
      textHeld = false
      for (const release of heldText.splice(0)) release()
    },
    refuseNextEdit: () => {
      refuseNext = true
    },
    refuseNextBulk: () => {
      refuseBulkNext = true
    },
    refuseKeys: (keys) => {
      for (const key of keys) refusedKeys.add(key)
    },
    dropIssue: (key) => {
      const target = find(key)
      if (target !== undefined) issues.splice(issues.indexOf(target), 1)
    },
    moveIssue: (key, status) => {
      const target = find(key)
      if (target === undefined) return
      target.fields.status = status === 'hold' ? HOLD : STATUSES[status]
      touch(target)
    },
    releaseUpload: () => {
      heldUploads.shift()?.()
    },
    failUpload: () => {
      failNextUpload = true
    },
    joinSprint: (keys, sprintId) => {
      for (const key of keys) {
        const target = find(key)
        if (target === undefined) continue
        target.fields[FIELDS.sprint] = SPRINTS.filter((s) => s.id === sprintId)
        touch(target)
      }
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
    setComment: (key, id, body) => {
      const found = comments.get(key)?.find((c) => c.id === id)
      if (found === undefined) return
      found.body = body
      found.updated = new Date(Date.UTC(2026, 9, 3, 1, 0, ++clock)).toISOString()
    },
    removeComment: (key, id) => {
      comments.set(
        key,
        (comments.get(key) ?? []).filter((c) => c.id !== id),
      )
    },
    addWorklog: (key, comment) => {
      const when = new Date(Date.UTC(2026, 9, 3, 2, 0, ++clock)).toISOString()
      worklogs.set(key, [
        ...(worklogs.get(key) ?? []),
        {
          id: FIRST_WORKLOG + 500 + worklogIds++,
          author: ME,
          seconds: 3600,
          started: when,
          comment,
          created: when,
          updated: when,
        },
      ])
      const target = find(key)
      if (target !== undefined) syncSpent(target)
    },
    logWork: (key, started, seconds) => {
      const target = find(key)
      if (target === undefined) return
      const when = new Date(Date.UTC(2026, 9, 3, 2, 0, ++clock)).toISOString()
      worklogs.set(key, [
        ...(worklogs.get(key) ?? []),
        {
          id: FIRST_WORKLOG + 500 + worklogIds++,
          author: ME,
          seconds,
          started,
          comment: null,
          created: when,
          updated: when,
        },
      ])
      syncSpent(target)
      touch(target)
    },
    setEstimate: (key, estimate) => {
      const target = find(key)
      if (target === undefined) return
      const { timeSpentSeconds } = target.fields.timetracking
      target.fields.timetracking = {
        ...(estimate !== null && {
          originalEstimateSeconds: estimate,
          remainingEstimateSeconds: Math.max(0, estimate - (timeSpentSeconds ?? 0)),
        }),
        ...(timeSpentSeconds !== undefined && { timeSpentSeconds }),
      }
      touch(target)
    },
    holdReads: () => {
      readsHeld = true
    },
    releaseReads: () => {
      readsHeld = false
      for (const release of heldReads.splice(0)) release()
    },
    inboxChange: (key, by, items) => {
      const target = find(key)
      if (target === undefined) return
      target.fields.updated = recently()
      inboxKeys.add(key)
      const list = histories.get(key) ?? []
      list.push({
        id: String(10000 + list.length),
        created: target.fields.updated,
        author: by === 'me' ? ME : OTHER,
        items,
      })
      histories.set(key, list)
    },
    inboxComment: (key, by) => {
      const target = find(key)
      if (target === undefined) return
      target.fields.updated = recently()
      inboxKeys.add(key)
      const when = target.fields.updated
      comments.set(key, [
        ...(comments.get(key) ?? []),
        {
          id: FIRST_COMMENT + 900 + commentIds++,
          author: by === 'me' ? ME : OTHER,
          body: doc('A comment for the Inbox'),
          created: when,
          updated: when,
        },
      ])
    },
    inboxWatch: (key) => {
      if (find(key) !== undefined) inboxKeys.add(key)
    },
    cancelNextDownload: () => {
      cancelDownload = true
    },
    takeDownloadCancel: () => {
      const asked = cancelDownload
      cancelDownload = false
      return asked
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
