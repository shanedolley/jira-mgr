import type { ErrorCode } from '@jira-mgr/core'

/** What a flag or argument accepts. `values.ts` holds one parser per type. */
export type ValueType =
  | 'text'
  | 'markdown'
  | 'file'
  | 'issue-key'
  | 'id'
  | 'date'
  | 'datetime'
  | 'duration'
  | 'number'
  | 'integer'
  | 'enum'
  | 'boolean'

export interface ArgSpec {
  /** kebab-case; the input key is its camelCase form. */
  name: string
  type: ValueType
  description: string
  /** Required unless set; optional args follow required ones. */
  optional?: boolean
  /** Last arg only; collects into an array. */
  variadic?: boolean
  /** `enum` only. */
  choices?: readonly string[]
}

export interface OptionSpec {
  /** `with-subtasks` gives `--with-subtasks` and the input key `withSubtasks`. */
  name: string
  type: ValueType
  description: string
  /** `--parent <key>`; defaults to the type. */
  valueName?: string
  /** `enum` only, matched in any case. */
  choices?: readonly string[]
  required?: boolean
  default?: string | number | boolean
  /** `--label a --label b` gives `['a', 'b']`. */
  repeatable?: boolean
  /** The value `none`, in any case, becomes `null`. */
  clearable?: boolean
  /** Other option names of the same command. */
  conflicts?: readonly string[]
}

export interface CommandSpec {
  /** `['issue', 'list']`; the id is `path.join(' ')`. */
  path: readonly [string, ...string[]]
  /** One line, for parent help and tables. */
  summary: string
  /** Longer help; defaults to the summary. */
  description?: string
  args?: readonly ArgSpec[]
  options?: readonly OptionSpec[]
  /** At least one. */
  examples: readonly { command: string; description: string }[]
  /** `example` is the data the JSON envelope carries. */
  output: { summary: string; example: unknown }
  /** Command-specific cases only; `help --json` lists every code. */
  exits?: readonly { code: ErrorCode; when: string }[]
  /** `[]` for a read. */
  writes: readonly ('jira' | 'state' | 'keychain')[]
  /** Core functions, such as `@jira-mgr/core/write#deleteIssue`. */
  calls: readonly string[]
}

/** Noun to summary, for `jm issue --help`. */
export const NOUNS: Record<string, string> = {
  auth: 'Log in to Jira and check the login',
  issue: 'List, read, create, edit and delete issues',
  status: 'Move an issue to another status',
  comment: 'Read and write issue comments',
  worklog: 'Read and write issue worklogs',
  link: 'Read and write links between issues',
  attach: 'Read and write issue attachments',
  sprint: 'List sprints and move issues between them',
  field: 'List the values a field accepts',
  view: 'List saved views',
  timer: 'Time your work on one issue at a time',
}

export const GLOBAL_OPTIONS = [
  {
    name: 'json',
    type: 'boolean',
    description: 'Print the result as JSON, even on a terminal.',
  },
] as const satisfies readonly OptionSpec[]

// Example data the specs share.
const ISSUE = {
  id: '10042',
  key: 'PSAPAC-12',
  summary: 'Build the loader',
  issueType: { id: '10001', name: 'Story', subtask: false, hierarchyLevel: 0 },
  status: { id: '3', name: 'In Progress', category: 'indeterminate' },
  resolution: null,
  parentKey: 'PSAPAC-10',
  assignee: { accountId: '5b10ac8d82e05b22cc7d4ef5', displayName: 'Shane Dolley', avatarUrl: null },
  creator: { accountId: '5b10ac8d82e05b22cc7d4ef5', displayName: 'Shane Dolley' },
  labels: ['etl'],
  links: [{ type: 'Blocks', direction: 'inward', key: 'PSAPAC-9', category: 'indeterminate' }],
  priority: { id: '3', name: 'Medium' },
  customer: { id: '10100', value: 'Acme Corp' },
  engagement: { id: '10200', value: 'Data migration' },
  sprints: [{ id: 7, name: 'Sprint 7', state: 'active', endDate: null }],
  startDate: '2026-10-01',
  dueDate: '2026-10-14',
  originalEstimateSeconds: 28800,
  remainingEstimateSeconds: 14400,
  timeSpentSeconds: 14400,
  timeRemainingHours: null,
  created: '2026-09-28T01:02:03.000Z',
  updated: '2026-10-06T23:10:00.000Z',
} as const

const PERSON = { accountId: '5b10ac8d82e05b22cc7d4ef5', displayName: 'Shane Dolley' } as const
const ADF = {
  type: 'doc',
  version: 1,
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Checked.' }] }],
} as const
const COMMENT = {
  id: '10500',
  author: PERSON,
  body: ADF,
  created: '2026-10-06T23:10:00.000Z',
  updated: '2026-10-06T23:10:00.000Z',
} as const
const WORKLOG = {
  id: '10600',
  author: PERSON,
  timeSpent: '1h 30m',
  timeSpentSeconds: 5400,
  started: '2026-10-06T23:10:00.000Z',
  comment: null,
  created: '2026-10-06T23:10:00.000Z',
  updated: '2026-10-06T23:10:00.000Z',
} as const
const ATTACHMENT = {
  id: '10700',
  filename: 'notes.txt',
  size: 120,
  mimeType: 'text/plain',
  created: '2026-10-06T23:10:00.000Z',
  author: PERSON,
  contentUrl: 'https://example.atlassian.net/rest/api/3/attachment/content/10700',
} as const
const LINK_TYPE = {
  id: '10000',
  name: 'Blocks',
  inward: 'is blocked by',
  outward: 'blocks',
} as const
const SPRINT = {
  id: 7,
  name: 'Sprint 7',
  state: 'active',
  startDate: '2026-10-01T00:00:00.000Z',
  endDate: '2026-10-15T00:00:00.000Z',
} as const
const DRAFT = {
  issueKey: 'PSAPAC-12',
  started: '2026-10-06T23:10:00.000Z',
  seconds: 5400,
  timeSpent: '1h 30m',
  needsConfirmation: false,
} as const
const TIMER_STATUS = {
  issueKey: 'PSAPAC-12',
  state: 'running',
  elapsedSeconds: 5400,
  draft: DRAFT,
} as const

const DESCRIPTION_OPTIONS = [
  {
    name: 'description',
    type: 'markdown',
    valueName: 'markdown',
    description: 'Description as Markdown.',
    conflicts: ['description-file', 'adf'],
  },
  {
    name: 'description-file',
    type: 'file',
    description: 'Read the description as Markdown from a file, or `-` for stdin.',
    conflicts: ['description', 'adf'],
  },
  {
    name: 'adf',
    type: 'file',
    description: 'Read the description as an Atlassian Document Format file, or `-` for stdin.',
    conflicts: ['description', 'description-file'],
  },
] as const satisfies readonly OptionSpec[]

const BODY_OPTIONS = [
  {
    name: 'body',
    type: 'markdown',
    valueName: 'markdown',
    description: 'Body as Markdown.',
    conflicts: ['body-file', 'adf'],
  },
  {
    name: 'body-file',
    type: 'file',
    description: 'Read the body as Markdown from a file, or `-` for stdin.',
    conflicts: ['body', 'adf'],
  },
  {
    name: 'adf',
    type: 'file',
    description: 'Read the body as an Atlassian Document Format file, or `-` for stdin.',
    conflicts: ['body', 'body-file'],
  },
] as const satisfies readonly OptionSpec[]

const FILTER_OPTIONS = [
  {
    name: 'view',
    type: 'text',
    valueName: 'id-or-name',
    description: 'Start from a saved view, by id or by name in any case.',
  },
  { name: 'search', type: 'text', description: 'Match this text in the summary or key.' },
  {
    name: 'assignee',
    type: 'text',
    valueName: 'assignee',
    description: 'Keep issues assigned to `me`, `unassigned` or an account id.',
    repeatable: true,
  },
  {
    name: 'status',
    type: 'text',
    valueName: 'name-or-id',
    description: 'Keep issues in this status.',
    repeatable: true,
  },
  { name: 'label', type: 'text', description: 'Keep issues with this label.', repeatable: true },
  {
    name: 'type',
    type: 'text',
    valueName: 'name-or-id',
    description: 'Keep issues of this type.',
    repeatable: true,
  },
  {
    name: 'sprint',
    type: 'text',
    valueName: 'sprint',
    description: 'Keep issues in this sprint: an id, a name or `current`.',
    repeatable: true,
  },
  { name: 'mine', type: 'boolean', description: 'Keep only issues assigned to you.' },
  { name: 'show-done', type: 'boolean', description: 'Include Done issues.' },
] as const satisfies readonly OptionSpec[]

const CLEAR_HINT = 'Pass `none` to clear it.'

export const COMMANDS = [
  // auth (L2)
  {
    path: ['auth', 'login'],
    summary: 'Log in and store the API token in the Keychain',
    description:
      'Verifies the credentials against Jira, saves the site, project and email to the settings file and the token to the Keychain. On a terminal it prompts for a missing site, project, email or token. The token never travels in a flag.',
    options: [
      {
        name: 'site',
        type: 'text',
        valueName: 'url',
        description: 'The Jira site URL. Defaults to the settings file.',
      },
      {
        name: 'project',
        type: 'text',
        valueName: 'key',
        description: 'The Jira project key. Defaults to the settings file.',
      },
      {
        name: 'email',
        type: 'text',
        description: 'The account email. Defaults to the settings file.',
      },
      { name: 'token-stdin', type: 'boolean', description: 'Read the API token from stdin.' },
    ],
    examples: [
      { command: 'jm auth login', description: 'Log in, prompting for what is missing.' },
      {
        command:
          'jm auth login --site https://example.atlassian.net --project PSAPAC --email me@example.com --token-stdin',
        description: 'Log in without prompts, reading the token from stdin.',
      },
    ],
    output: {
      summary: 'The account that is now logged in.',
      example: {
        siteUrl: 'https://example.atlassian.net',
        projectKey: 'PSAPAC',
        email: 'me@example.com',
        accountId: '5b10ac8d82e05b22cc7d4ef5',
        displayName: 'Shane Dolley',
      },
    },
    exits: [
      {
        code: 'validation_failed',
        when: 'A value is missing and there is no terminal to prompt on.',
      },
      { code: 'permission_denied', when: 'Jira refuses the token.' },
    ],
    writes: ['state', 'keychain'],
    calls: ['@jira-mgr/core/auth#login'],
  },
  {
    path: ['auth', 'status'],
    summary: 'Show who is logged in',
    examples: [{ command: 'jm auth status', description: 'Show the logged-in account.' }],
    output: {
      summary: 'The logged-in account and when the custom fields were last resolved.',
      example: {
        siteUrl: 'https://example.atlassian.net',
        projectKey: 'PSAPAC',
        email: 'me@example.com',
        accountId: '5b10ac8d82e05b22cc7d4ef5',
        displayName: 'Shane Dolley',
        fieldsResolvedAt: '2026-10-06T23:10:00.000Z',
      },
    },
    exits: [{ code: 'permission_denied', when: 'No one is logged in.' }],
    writes: [],
    calls: [
      '@jira-mgr/core/auth#getCredentials',
      '@jira-mgr/core/state#readFields',
      '@jira-mgr/core/lookups#getCurrentUser',
    ],
  },
  {
    path: ['auth', 'logout'],
    summary: 'Remove the stored token',
    examples: [
      { command: 'jm auth logout', description: 'Log out. Succeeds when already logged out.' },
    ],
    output: { summary: 'Confirms the logout.', example: { loggedOut: true } },
    writes: ['keychain', 'state'],
    calls: ['@jira-mgr/core/auth#logout'],
  },

  // issue (L3, L4)
  {
    path: ['issue', 'list'],
    summary: 'List issues',
    description:
      "Lists the project's issues, hiding Done ones unless `--show-done`. A view's filters apply first, and each filter flag replaces that field's list.",
    options: [
      ...FILTER_OPTIONS,
      { name: 'limit', type: 'integer', description: 'Stop after this many matching issues.' },
    ],
    examples: [
      { command: 'jm issue list --mine', description: 'List your open issues.' },
      {
        command: 'jm issue list --status "In Progress" --label etl --limit 20',
        description: 'List up to 20 in-progress issues labelled etl.',
      },
    ],
    output: { summary: 'An array of issues.', example: [ISSUE] },
    exits: [
      { code: 'not_found', when: '`--view` names no saved view.' },
      { code: 'validation_failed', when: 'A state file, such as the saved views, is invalid.' },
    ],
    writes: [],
    calls: [
      '@jira-mgr/core/state#findView',
      '@jira-mgr/core/search#searchIssuePages',
      '@jira-mgr/core/view-filter#issueMatcher',
    ],
  },
  {
    path: ['issue', 'tree'],
    summary: 'Show issues grouped by Customer and Epic',
    description:
      'Groups the same issues as `issue list` by Customer, then Epic, with Subtasks under their parents. Children sort by key number alone, newest first. With `--show-done` or a view that shows Done, Done children collapse into a `+N done` chip; otherwise no Done issue shows.',
    options: [
      ...FILTER_OPTIONS,
      {
        name: 'show-empty-customers',
        type: 'boolean',
        description: 'Include Customers with no matching issue.',
      },
    ],
    examples: [
      { command: 'jm issue tree --mine', description: 'Show your open issues as a tree.' },
    ],
    output: {
      summary: 'An array of Customer groups, each with its Epics and the issues under no Epic.',
      example: [
        {
          customer: { id: '10100', value: 'Acme Corp' },
          epics: [
            {
              issue: ISSUE,
              children: [],
              doneChildren: [],
              doneCount: 0,
              contextOnly: false,
              customerMismatch: null,
            },
          ],
          noEpic: [],
        },
      ],
    },
    exits: [
      { code: 'not_found', when: '`--view` names no saved view.' },
      { code: 'validation_failed', when: 'A state file, such as the saved views, is invalid.' },
    ],
    writes: [],
    calls: [
      '@jira-mgr/core/state#findView',
      '@jira-mgr/core/search#searchIssuePages',
      '@jira-mgr/core/view-filter#issueMatcher',
      '@jira-mgr/core/hierarchy#buildHierarchy',
      '@jira-mgr/core/lookups#getFieldOptions',
    ],
  },
  {
    path: ['issue', 'get'],
    summary: 'Show one issue',
    args: [{ name: 'key', type: 'issue-key', description: 'The issue key, such as PSAPAC-12.' }],
    examples: [
      {
        command: 'jm issue get PSAPAC-12',
        description: 'Show PSAPAC-12 with its description and subtasks.',
      },
    ],
    output: {
      summary:
        'The issue, its description as ADF and as Markdown, its subtasks, its URL and its `commentCount`. Only a single-issue read carries `commentCount`: `issue list` and `issue tree` do not ask Jira for it.',
      example: {
        ...ISSUE,
        commentCount: 3,
        description: ADF,
        descriptionMarkdown: 'Checked.',
        subtasks: [{ key: 'PSAPAC-13', summary: 'Write the tests', status: 'To Do' }],
        url: 'https://example.atlassian.net/browse/PSAPAC-12',
      },
    },
    exits: [
      { code: 'not_found', when: 'The issue does not exist.' },
      {
        code: 'validation_failed',
        when: 'The site in settings is not an Atlassian Cloud site.',
      },
    ],
    writes: [],
    calls: ['@jira-mgr/core/search#getIssue', '@jira-mgr/core/adf#adfToMarkdown'],
  },
  {
    path: ['issue', 'create'],
    summary: 'Create an issue',
    description:
      'Creates an issue. Customer and Engagement are required; name them in any case or by option id. Give at most one of the three description inputs.',
    options: [
      {
        name: 'type',
        type: 'enum',
        valueName: 'type',
        choices: ['Epic', 'Story', 'Task', 'Bug', 'Subtask'],
        default: 'Story',
        description: 'The issue type.',
      },
      { name: 'summary', type: 'text', required: true, description: 'The summary line.' },
      {
        name: 'customer',
        type: 'text',
        valueName: 'name-or-id',
        required: true,
        description: 'The Customer.',
      },
      {
        name: 'engagement',
        type: 'text',
        valueName: 'name-or-id',
        required: true,
        description: 'The Engagement.',
      },
      { name: 'parent', type: 'issue-key', valueName: 'key', description: 'The parent issue.' },
      ...DESCRIPTION_OPTIONS,
      {
        name: 'assignee',
        type: 'text',
        valueName: 'assignee',
        description: 'Assign to `me`, an account id or a name that matches one user.',
      },
      { name: 'priority', type: 'text', valueName: 'name-or-id', description: 'The priority.' },
      {
        name: 'label',
        type: 'text',
        repeatable: true,
        description: 'A label. Repeat the flag for more.',
      },
      { name: 'start', type: 'date', description: 'The start date, YYYY-MM-DD.' },
      { name: 'due', type: 'date', description: 'The due date, YYYY-MM-DD.' },
      {
        name: 'estimate',
        type: 'duration',
        description: 'The original estimate, such as `1d 4h`.',
      },
      { name: 'time-remaining', type: 'number', description: 'The Time remaining field value.' },
    ],
    examples: [
      {
        command:
          'jm issue create --summary "Build the loader" --customer "Acme Corp" --engagement "Data migration" --parent PSAPAC-10',
        description: 'Create a Story under an Epic.',
      },
      {
        command:
          'jm issue create --type Bug --summary "Loader drops rows" --customer "Acme Corp" --engagement "Data migration" --description-file bug.md',
        description: 'Create a Bug with a Markdown description from a file.',
      },
    ],
    output: {
      summary:
        'The new issue, read back after the create: the same object as `jm issue get`. It shows the issue as Jira returned it straight after the create. On PSAPAC an automation rule can change the estimates, labels, Customer, parent and sprint within about 10 seconds, so run `jm issue get <key>` after that to see the final values.',
      example: {
        ...ISSUE,
        commentCount: 3,
        description: ADF,
        descriptionMarkdown: 'Checked.',
        subtasks: [],
        url: 'https://example.atlassian.net/browse/PSAPAC-12',
      },
    },
    exits: [
      {
        code: 'validation_failed',
        when: 'A name is unknown or ambiguous, two description inputs are given, a Subtask has no `--parent`, or `--parent` is outside the project in settings.',
      },
      { code: 'permission_denied', when: 'No project is set in settings.' },
      {
        code: 'jira_error',
        when: 'The create succeeded but the read-back failed. The issue exists: `error.details` holds its `key` and `id`, so read it with `jm issue get` and do not create it again.',
      },
    ],
    writes: ['jira'],
    calls: [
      '@jira-mgr/core/write#createIssue',
      '@jira-mgr/core/search#getIssue',
      '@jira-mgr/core/lookups#getFieldOptions',
      '@jira-mgr/core/lookups#searchAssignableUsers',
      '@jira-mgr/core/adf#markdownToAdf',
    ],
  },
  {
    path: ['issue', 'edit'],
    summary: 'Change fields on an issue',
    description:
      'Changes only the fields you pass. A flag marked clearable takes `none` to empty the field. `--label` replaces the labels and conflicts with `--add-label` and `--remove-label`.',
    args: [{ name: 'key', type: 'issue-key', description: 'The issue key.' }],
    options: [
      { name: 'summary', type: 'text', description: 'The summary line.' },
      ...DESCRIPTION_OPTIONS,
      {
        name: 'clear-description',
        type: 'boolean',
        description: 'Empty the description.',
        conflicts: ['description', 'description-file', 'adf'],
      },
      {
        name: 'assignee',
        type: 'text',
        valueName: 'assignee',
        clearable: true,
        description: `Assign to \`me\`, an account id or a name that matches one user. ${CLEAR_HINT}`,
      },
      {
        name: 'start',
        type: 'date',
        clearable: true,
        description: `The start date. ${CLEAR_HINT}`,
      },
      { name: 'due', type: 'date', clearable: true, description: `The due date. ${CLEAR_HINT}` },
      {
        name: 'time-remaining',
        type: 'number',
        clearable: true,
        description: `The Time remaining field value. ${CLEAR_HINT}`,
      },
      { name: 'priority', type: 'text', valueName: 'name-or-id', description: 'The priority.' },
      {
        name: 'label',
        type: 'text',
        repeatable: true,
        description: 'Replace the labels with these.',
        conflicts: ['add-label', 'remove-label'],
      },
      {
        name: 'add-label',
        type: 'text',
        repeatable: true,
        description: 'Add a label.',
        conflicts: ['label'],
      },
      {
        name: 'remove-label',
        type: 'text',
        repeatable: true,
        description: 'Remove a label.',
        conflicts: ['label'],
      },
      {
        name: 'parent',
        type: 'issue-key',
        valueName: 'key',
        description:
          'The parent issue. The Customer and Engagement are not copied from the new parent; pass `--customer` and `--engagement` to change them.',
      },
      { name: 'customer', type: 'text', valueName: 'name-or-id', description: 'The Customer.' },
      { name: 'engagement', type: 'text', valueName: 'name-or-id', description: 'The Engagement.' },
      {
        name: 'estimate',
        type: 'duration',
        description: 'The original estimate, such as `1d 4h`.',
      },
      {
        name: 'type',
        type: 'enum',
        valueName: 'type',
        choices: ['Story', 'Task', 'Bug'],
        description:
          'Change the issue type. Only a Story, Task or Bug can change, and only to one of the three.',
      },
    ],
    examples: [
      {
        command: 'jm issue edit PSAPAC-12 --assignee me --due 2026-10-14',
        description: 'Assign to yourself and set a due date.',
      },
      {
        command: 'jm issue edit PSAPAC-12 --assignee none --add-label etl',
        description: 'Unassign and add a label.',
      },
    ],
    output: {
      summary: 'The issue key and the names of the options sent, each once.',
      example: { key: 'PSAPAC-12', changed: ['assignee', 'due'] },
    },
    exits: [
      {
        code: 'validation_failed',
        when: 'Nothing is given to change, a name is unknown or ambiguous, `--type` is given for an issue that is not a Story, Task or Bug, or the key or `--parent` is outside the project in settings.',
      },
      { code: 'permission_denied', when: 'No project is set in settings.' },
      { code: 'not_found', when: 'The issue does not exist.' },
    ],
    writes: ['jira'],
    calls: [
      '@jira-mgr/core/search#getIssue',
      '@jira-mgr/core/write#editIssue',
      '@jira-mgr/core/lookups#getFieldOptions',
      '@jira-mgr/core/lookups#searchAssignableUsers',
      '@jira-mgr/core/adf#markdownToAdf',
    ],
  },
  {
    path: ['issue', 'delete'],
    summary: 'Delete issues permanently',
    description:
      'Deletes the issues for good. `--confirm` is required. An issue with subtasks needs `--with-subtasks`, which deletes them too. Several keys are deleted one at a time, lowest level first: subtasks, then stories, tasks and bugs, then epics. A key that fails does not stop the rest, and the command exits with the code of the first failure. With several keys each one prints to stderr as it settles, so Ctrl-C part way still shows what went.',
    args: [{ name: 'keys', type: 'issue-key', variadic: true, description: 'The issue keys.' }],
    options: [
      { name: 'confirm', type: 'boolean', description: 'Confirm the permanent delete.' },
      { name: 'with-subtasks', type: 'boolean', description: "Delete the issues' subtasks too." },
    ],
    examples: [
      {
        command: 'jm issue delete PSAPAC-12 --confirm',
        description: 'Delete an issue with no subtasks.',
      },
      {
        command: 'jm issue delete PSAPAC-12 --confirm --with-subtasks',
        description: 'Delete an issue and its subtasks.',
      },
      {
        command: 'jm issue delete PSAPAC-10 PSAPAC-12 PSAPAC-13 --confirm --with-subtasks',
        description: 'Delete an epic, a story and its subtask, subtask first.',
      },
    ],
    output: {
      summary:
        'With one key, the deleted key and the subtasks deleted with it. With several, `deleted` lists those entries in the order they were deleted and `failed` lists each key that failed with its `error` (`code` and `message`).',
      example: { key: 'PSAPAC-12', deletedSubtasks: ['PSAPAC-13'] },
    },
    exits: [
      {
        code: 'validation_failed',
        when: '`--confirm` is missing, an issue has subtasks and `--with-subtasks` is missing, or a key is outside the project in settings.',
      },
      { code: 'permission_denied', when: 'No project is set in settings.' },
      { code: 'not_found', when: 'An issue does not exist.' },
    ],
    writes: ['jira'],
    calls: ['@jira-mgr/core/state#assertInProject', '@jira-mgr/core/write#deleteIssues'],
  },

  // status (L4)
  {
    path: ['status', 'set'],
    summary: 'Move an issue to a status',
    args: [
      { name: 'key', type: 'issue-key', description: 'The issue key.' },
      { name: 'status', type: 'text', description: 'The status name in any case, or its id.' },
    ],
    examples: [
      { command: 'jm status set PSAPAC-12 "In Progress"', description: 'Start work on an issue.' },
    ],
    output: {
      summary: 'The issue, its status and whether a transition ran.',
      example: { key: 'PSAPAC-12', status: 'In Progress', changed: true },
    },
    exits: [
      {
        code: 'validation_failed',
        when: 'The status is unreachable from the current one (the message lists the available statuses), or the key is outside the project in settings.',
      },
      { code: 'permission_denied', when: 'No project is set in settings.' },
      { code: 'not_found', when: 'The issue does not exist.' },
    ],
    writes: ['jira'],
    calls: ['@jira-mgr/core/search#getIssue', '@jira-mgr/core/write#transitionIssue'],
  },

  // comment (L5)
  {
    path: ['comment', 'list'],
    summary: 'List the comments on an issue',
    args: [{ name: 'key', type: 'issue-key', description: 'The issue key.' }],
    examples: [
      { command: 'jm comment list PSAPAC-12', description: 'List the comments, oldest first.' },
    ],
    output: {
      summary: 'An array of comments, each with its body as ADF and as Markdown.',
      example: [{ ...COMMENT, bodyMarkdown: 'Checked.' }],
    },
    exits: [{ code: 'not_found', when: 'The issue does not exist.' }],
    writes: [],
    calls: ['@jira-mgr/core/extras#listComments', '@jira-mgr/core/adf#adfToMarkdown'],
  },
  {
    path: ['comment', 'add'],
    summary: 'Add a comment to an issue',
    description: 'Give one of `--body`, `--body-file` or `--adf`.',
    args: [{ name: 'key', type: 'issue-key', description: 'The issue key.' }],
    options: [...BODY_OPTIONS],
    examples: [
      {
        command: 'jm comment add PSAPAC-12 --body "Checked."',
        description: 'Add a Markdown comment.',
      },
    ],
    output: { summary: 'The new comment.', example: COMMENT },
    exits: [
      {
        code: 'validation_failed',
        when: 'No body input is given, or more than one, or the key is outside the project in settings.',
      },
      { code: 'permission_denied', when: 'No project is set in settings.' },
      { code: 'not_found', when: 'The issue does not exist.' },
    ],
    writes: ['jira'],
    calls: ['@jira-mgr/core/extras#addComment', '@jira-mgr/core/adf#markdownToAdf'],
  },
  {
    path: ['comment', 'edit'],
    summary: 'Replace the body of a comment',
    description: 'Give one of `--body`, `--body-file` or `--adf`.',
    args: [
      { name: 'key', type: 'issue-key', description: 'The issue key.' },
      { name: 'comment-id', type: 'id', description: 'The comment id from `comment list`.' },
    ],
    options: [...BODY_OPTIONS],
    examples: [
      {
        command: 'jm comment edit PSAPAC-12 10500 --body "Checked twice."',
        description: 'Replace a comment.',
      },
    ],
    output: { summary: 'The edited comment.', example: COMMENT },
    exits: [
      {
        code: 'validation_failed',
        when: 'No body input is given, or more than one, or the key is outside the project in settings.',
      },
      { code: 'permission_denied', when: 'No project is set in settings.' },
      { code: 'not_found', when: 'The issue or the comment does not exist.' },
    ],
    writes: ['jira'],
    calls: ['@jira-mgr/core/extras#editComment', '@jira-mgr/core/adf#markdownToAdf'],
  },
  {
    path: ['comment', 'delete'],
    summary: 'Delete a comment',
    args: [
      { name: 'key', type: 'issue-key', description: 'The issue key.' },
      { name: 'comment-id', type: 'id', description: 'The comment id from `comment list`.' },
    ],
    examples: [{ command: 'jm comment delete PSAPAC-12 10500', description: 'Delete a comment.' }],
    output: { summary: 'The deleted comment.', example: { key: 'PSAPAC-12', commentId: '10500' } },
    exits: [
      { code: 'validation_failed', when: 'The key is outside the project in settings.' },
      { code: 'permission_denied', when: 'No project is set in settings.' },
      { code: 'not_found', when: 'The issue or the comment does not exist.' },
    ],
    writes: ['jira'],
    calls: ['@jira-mgr/core/extras#deleteComment'],
  },

  // worklog (L5)
  {
    path: ['worklog', 'list'],
    summary: 'List the worklogs on an issue',
    args: [{ name: 'key', type: 'issue-key', description: 'The issue key.' }],
    examples: [{ command: 'jm worklog list PSAPAC-12', description: 'List the worklogs.' }],
    output: { summary: 'An array of worklogs.', example: [WORKLOG] },
    exits: [{ code: 'not_found', when: 'The issue does not exist.' }],
    writes: [],
    calls: ['@jira-mgr/core/extras#listWorklogs'],
  },
  {
    path: ['worklog', 'add'],
    summary: 'Log time on an issue',
    args: [{ name: 'key', type: 'issue-key', description: 'The issue key.' }],
    options: [
      {
        name: 'time',
        type: 'duration',
        required: true,
        description: 'Time spent, such as `1h 30m`.',
      },
      { name: 'started', type: 'datetime', description: 'When the work started. Defaults to now.' },
      {
        name: 'comment',
        type: 'markdown',
        valueName: 'markdown',
        description: 'A comment, as Markdown.',
      },
    ],
    examples: [
      {
        command: 'jm worklog add PSAPAC-12 --time 1h30m',
        description: 'Log an hour and a half, started now.',
      },
      {
        command:
          'jm worklog add PSAPAC-12 --time 2h --started "2026-10-06 09:00" --comment "Pairing"',
        description: 'Log time from yesterday morning, local time.',
      },
    ],
    output: { summary: 'The new worklog.', example: WORKLOG },
    exits: [
      { code: 'validation_failed', when: 'The key is outside the project in settings.' },
      { code: 'permission_denied', when: 'No project is set in settings.' },
      { code: 'not_found', when: 'The issue does not exist.' },
    ],
    writes: ['jira'],
    calls: ['@jira-mgr/core/extras#addWorklog', '@jira-mgr/core/adf#markdownToAdf'],
  },
  {
    path: ['worklog', 'edit'],
    summary: 'Change a worklog',
    description: 'Give at least one of `--time`, `--started` and `--comment`.',
    args: [
      { name: 'key', type: 'issue-key', description: 'The issue key.' },
      { name: 'worklog-id', type: 'id', description: 'The worklog id from `worklog list`.' },
    ],
    options: [
      { name: 'time', type: 'duration', description: 'Time spent, such as `1h 30m`.' },
      { name: 'started', type: 'datetime', description: 'When the work started.' },
      {
        name: 'comment',
        type: 'markdown',
        valueName: 'markdown',
        description: 'A comment, as Markdown.',
      },
    ],
    examples: [
      {
        command: 'jm worklog edit PSAPAC-12 10600 --time 2h',
        description: 'Change the time spent.',
      },
    ],
    output: { summary: 'The edited worklog.', example: WORKLOG },
    exits: [
      {
        code: 'validation_failed',
        when: 'No field is given to change, or the key is outside the project in settings.',
      },
      { code: 'permission_denied', when: 'No project is set in settings.' },
      { code: 'not_found', when: 'The issue does not exist, or the worklog is not on that issue.' },
    ],
    writes: ['jira'],
    calls: ['@jira-mgr/core/extras#editWorklog', '@jira-mgr/core/adf#markdownToAdf'],
  },
  {
    path: ['worklog', 'delete'],
    summary: 'Delete a worklog',
    args: [
      { name: 'key', type: 'issue-key', description: 'The issue key.' },
      { name: 'worklog-id', type: 'id', description: 'The worklog id from `worklog list`.' },
    ],
    examples: [{ command: 'jm worklog delete PSAPAC-12 10600', description: 'Delete a worklog.' }],
    output: { summary: 'The deleted worklog.', example: { key: 'PSAPAC-12', worklogId: '10600' } },
    exits: [
      { code: 'validation_failed', when: 'The key is outside the project in settings.' },
      { code: 'permission_denied', when: 'No project is set in settings.' },
      { code: 'not_found', when: 'The issue does not exist, or the worklog is not on that issue.' },
    ],
    writes: ['jira'],
    calls: ['@jira-mgr/core/extras#deleteWorklog'],
  },

  // link (L3, L5)
  {
    path: ['link', 'types'],
    summary: 'List the link types',
    examples: [{ command: 'jm link types', description: 'List the link types and their phrases.' }],
    output: { summary: 'An array of link types.', example: [LINK_TYPE] },
    writes: [],
    calls: ['@jira-mgr/core/extras#listLinkTypes'],
  },
  {
    path: ['link', 'list'],
    summary: 'List the links on an issue',
    args: [{ name: 'key', type: 'issue-key', description: 'The issue key.' }],
    examples: [
      {
        command: 'jm link list PSAPAC-12',
        description: 'List the links, each seen from PSAPAC-12.',
      },
    ],
    output: {
      summary: 'An array of links, each seen from the issue.',
      example: [
        {
          id: '10800',
          type: LINK_TYPE,
          direction: 'outward',
          issue: { key: 'PSAPAC-13', summary: 'Write the tests', status: 'To Do' },
        },
      ],
    },
    exits: [{ code: 'not_found', when: 'The issue does not exist.' }],
    writes: [],
    calls: ['@jira-mgr/core/extras#listLinks'],
  },
  {
    path: ['link', 'add'],
    summary: 'Link two issues',
    description:
      "Reads as a sentence: `jm link add PSAPAC-1 blocks PSAPAC-2`. The phrase matches, in any case, a link type's name or outward text, or its inward text. A phrase that matches more than one type is refused. Not idempotent: each call adds another link.",
    args: [
      { name: 'key', type: 'issue-key', description: 'The issue the phrase describes.' },
      {
        name: 'phrase',
        type: 'text',
        description: 'A link type name or phrase, such as `blocks` or `is blocked by`.',
      },
      { name: 'other-key', type: 'issue-key', description: 'The other issue.' },
    ],
    examples: [
      { command: 'jm link add PSAPAC-1 blocks PSAPAC-2', description: 'PSAPAC-1 blocks PSAPAC-2.' },
      {
        command: 'jm link add PSAPAC-1 "is blocked by" PSAPAC-2',
        description: 'PSAPAC-1 is blocked by PSAPAC-2.',
      },
    ],
    output: {
      summary: 'The new link.',
      example: {
        id: '10800',
        type: 'Blocks',
        direction: 'outward',
        key: 'PSAPAC-1',
        otherKey: 'PSAPAC-2',
      },
    },
    exits: [
      {
        code: 'validation_failed',
        when: 'The phrase matches no link type, or more than one, or a key is outside the project in settings.',
      },
      { code: 'permission_denied', when: 'No project is set in settings.' },
      { code: 'not_found', when: 'An issue does not exist.' },
    ],
    writes: ['jira'],
    calls: [
      '@jira-mgr/core/extras#listLinkTypes',
      '@jira-mgr/core/extras#addLink',
      '@jira-mgr/core/extras#listLinks',
    ],
  },
  {
    path: ['link', 'remove'],
    summary: 'Remove a link',
    args: [{ name: 'link-id', type: 'id', description: 'The link id from `link list`.' }],
    examples: [{ command: 'jm link remove 10800', description: 'Remove a link.' }],
    output: { summary: 'The removed link.', example: { linkId: '10800' } },
    description:
      'Reads the link first, and refuses it unless both issues it joins are in the project in settings.',
    exits: [
      {
        code: 'validation_failed',
        when: 'An issue the link joins is outside the project in settings.',
      },
      { code: 'permission_denied', when: 'No project is set in settings.' },
      { code: 'not_found', when: 'The link does not exist.' },
    ],
    writes: ['jira'],
    calls: ['@jira-mgr/core/extras#getLink', '@jira-mgr/core/extras#removeLink'],
  },

  // attach (L5)
  {
    path: ['attach', 'list'],
    summary: 'List the attachments on an issue',
    args: [{ name: 'key', type: 'issue-key', description: 'The issue key.' }],
    examples: [{ command: 'jm attach list PSAPAC-12', description: 'List the attachments.' }],
    output: { summary: 'An array of attachments.', example: [ATTACHMENT] },
    exits: [{ code: 'not_found', when: 'The issue does not exist.' }],
    writes: [],
    calls: ['@jira-mgr/core/extras#listAttachments'],
  },
  {
    path: ['attach', 'add'],
    summary: 'Attach files to an issue',
    args: [
      { name: 'key', type: 'issue-key', description: 'The issue key.' },
      { name: 'file', type: 'file', variadic: true, description: 'A file path. Give one or more.' },
    ],
    examples: [
      {
        command: 'jm attach add PSAPAC-12 notes.txt screenshot.png',
        description: 'Attach two files.',
      },
    ],
    output: { summary: 'The new attachments.', example: [ATTACHMENT] },
    exits: [
      {
        code: 'validation_failed',
        when: 'A path is not a readable regular file, or is `-`; a file is over the site upload limit; attachments are off; the key is outside the project in settings.',
      },
      { code: 'permission_denied', when: 'No project is set in settings.' },
      { code: 'not_found', when: 'The issue does not exist.' },
    ],
    writes: ['jira'],
    calls: ['@jira-mgr/core/extras#addAttachments'],
  },
  {
    path: ['attach', 'remove'],
    summary: 'Remove an attachment',
    args: [
      { name: 'attachment-id', type: 'id', description: 'The attachment id from `attach list`.' },
    ],
    examples: [{ command: 'jm attach remove 10700', description: 'Remove an attachment.' }],
    output: { summary: 'The removed attachment.', example: { attachmentId: '10700' } },
    exits: [{ code: 'not_found', when: 'The attachment does not exist.' }],
    writes: ['jira'],
    calls: ['@jira-mgr/core/extras#removeAttachment'],
  },

  // sprint (L3, L5)
  {
    path: ['sprint', 'list'],
    summary: 'List sprints',
    description:
      'Lists the active sprint and the dated future sprints. `--all` adds closed and undated ones.',
    options: [{ name: 'all', type: 'boolean', description: 'Include closed and undated sprints.' }],
    examples: [{ command: 'jm sprint list', description: 'List the active and upcoming sprints.' }],
    output: { summary: 'An array of sprints.', example: [SPRINT] },
    exits: [{ code: 'not_found', when: 'The project has no board that supports sprints.' }],
    writes: [],
    calls: ['@jira-mgr/core/sprints#findBoard', '@jira-mgr/core/sprints#listSprints'],
  },
  {
    path: ['sprint', 'set'],
    summary: 'Move issues to a sprint or the backlog',
    args: [
      {
        name: 'sprint',
        type: 'text',
        description: 'A sprint id, a name in any case, `current` or `backlog`.',
      },
      { name: 'key', type: 'issue-key', variadic: true, description: 'One to 50 issue keys.' },
    ],
    examples: [
      {
        command: 'jm sprint set current PSAPAC-12 PSAPAC-13',
        description: 'Move two issues to the active sprint.',
      },
      {
        command: 'jm sprint set backlog PSAPAC-12',
        description: 'Move an issue back to the backlog.',
      },
    ],
    output: {
      summary: 'The sprint, or null for the backlog, and the keys moved.',
      example: { sprint: { id: 7, name: 'Sprint 7' }, keys: ['PSAPAC-12', 'PSAPAC-13'] },
    },
    exits: [
      {
        code: 'validation_failed',
        when: 'The sprint matches none, or `current` with none or more than one active sprint; more than 50 keys; a key outside the project.',
      },
      { code: 'permission_denied', when: 'No project is set in settings.' },
      { code: 'not_found', when: 'The project has no board that supports sprints.' },
    ],
    writes: ['jira'],
    calls: [
      '@jira-mgr/core/sprints#findBoard',
      '@jira-mgr/core/sprints#listSprints',
      '@jira-mgr/core/sprints#moveToSprint',
      '@jira-mgr/core/sprints#moveToBacklog',
    ],
  },

  // field and view (L3)
  {
    path: ['field', 'options'],
    summary: 'List the values a field accepts',
    args: [
      {
        name: 'field',
        type: 'enum',
        choices: ['customer', 'engagement', 'priority', 'issue-type', 'status'],
        description: 'The field to list.',
      },
    ],
    examples: [{ command: 'jm field options customer', description: 'List the Customers.' }],
    output: { summary: 'An array of values.', example: [{ id: '10100', name: 'Acme Corp' }] },
    writes: [],
    calls: ['@jira-mgr/core/lookups#getFieldOptions'],
  },
  {
    path: ['view', 'list'],
    summary: 'List saved views',
    examples: [{ command: 'jm view list', description: 'List the saved views and their ids.' }],
    output: {
      summary:
        'An array of saved views. A view the app saved with a display also holds `display`, its row properties, issue order and direction: `{ "properties": ["updated"], "order": "key", "direction": "desc" }`. `direction` is the default for the order when the file holds none. `priority` is `false` when the user turned the priority slot off, and `true` or absent otherwise (both read as on). `widths`, when the user resized a column, maps a property name to its width in pixels (`"widths": { "labels": 120 }`) and is absent otherwise. Under `"order": "manual"`, `manual` lists the issue keys in the order the user placed them (`"manual": ["PSAPAC-3", "PSAPAC-1"]`); it is absent until a row is moved. The key is absent from a view with none.',
      example: [
        {
          id: 'my-issues',
          name: 'My issues',
          filters: {},
          toggles: { hideDone: true, assigneeMe: true, hideEmptyCustomers: true },
        },
      ],
    },
    writes: [],
    calls: ['@jira-mgr/core/state#readViews'],
  },

  // timer (L6)
  {
    path: ['timer', 'start'],
    summary: 'Start the timer on an issue',
    description:
      'Starts timing the issue. A timer already running on another issue is stopped and logged first. A draft that needs confirmation (past the reminder threshold, or across midnight) is refused unless `--confirm`.',
    args: [{ name: 'key', type: 'issue-key', description: 'The issue key.' }],
    options: [
      {
        name: 'expect',
        type: 'issue-key',
        valueName: 'key',
        description: "Refuse when another issue's timer is running; proceeds when none runs.",
      },
      {
        name: 'confirm',
        type: 'boolean',
        description: 'Log a draft that needs confirmation as it is.',
      },
    ],
    examples: [{ command: 'jm timer start PSAPAC-12', description: 'Start timing PSAPAC-12.' }],
    output: {
      summary: 'The running timer, the timer it stopped and the worklog that logged.',
      example: { timer: TIMER_STATUS, stopped: null, logged: null },
    },
    exits: [
      {
        code: 'validation_failed',
        when: 'The issue is an Epic, `--expect` names another issue, or the draft needs `--confirm`.',
      },
      { code: 'not_found', when: 'The issue does not exist.' },
    ],
    writes: ['state', 'jira'],
    calls: ['@jira-mgr/core/search#getIssue', '@jira-mgr/core/timer#switchAndLog'],
  },
  {
    path: ['timer', 'stop'],
    summary: 'Stop the timer and log the time',
    description:
      'Stops the timer and logs a worklog. `--time` replaces the measured time and needs `--expect`. `--discard` drops the timer and logs nothing. With no timer, it succeeds with `null`.',
    options: [
      {
        name: 'comment',
        type: 'markdown',
        valueName: 'markdown',
        description: 'A worklog comment, as Markdown.',
        conflicts: ['discard'],
      },
      {
        name: 'time',
        type: 'duration',
        description: 'Log this time instead of the measured time.',
        conflicts: ['discard'],
      },
      {
        name: 'expect',
        type: 'issue-key',
        valueName: 'key',
        description: "Refuse when another issue's timer is running; proceeds when none runs.",
      },
      {
        name: 'confirm',
        type: 'boolean',
        description: 'Log a draft that needs confirmation as it is.',
        conflicts: ['discard'],
      },
      {
        name: 'discard',
        type: 'boolean',
        description: 'Drop the timer without logging.',
        conflicts: ['comment', 'time', 'confirm'],
      },
    ],
    examples: [
      { command: 'jm timer stop', description: 'Stop the timer and log the measured time.' },
      { command: 'jm timer stop --discard', description: 'Drop the timer without logging.' },
    ],
    output: {
      summary:
        'The draft and the worklog; a null worklog with `--discard`; null when no timer runs.',
      example: { draft: DRAFT, worklog: WORKLOG },
    },
    exits: [
      {
        code: 'validation_failed',
        when: '`--time` without `--expect`, `--expect` names another issue, or the draft needs `--confirm`.',
      },
      { code: 'jira_error', when: 'The worklog failed; the timer stays paused.' },
    ],
    writes: ['state', 'jira'],
    calls: ['@jira-mgr/core/timer#stopAndLog', '@jira-mgr/core/timer#stopTimer'],
  },
  {
    path: ['timer', 'status'],
    summary: 'Show the running timer',
    examples: [
      { command: 'jm timer status', description: 'Show the timer and its draft worklog.' },
    ],
    output: {
      summary: 'The timer and its draft worklog, or null when none exists.',
      example: TIMER_STATUS,
    },
    writes: [],
    calls: [
      '@jira-mgr/core/state#readTimer',
      '@jira-mgr/core/state#readSettings',
      '@jira-mgr/core/timer-calc#worklogDraft',
    ],
  },
  {
    path: ['timer', 'pause'],
    summary: 'Pause the timer',
    examples: [{ command: 'jm timer pause', description: 'Pause the running timer.' }],
    output: { summary: 'The paused timer.', example: { ...TIMER_STATUS, state: 'paused' } },
    exits: [{ code: 'not_found', when: 'No timer exists.' }],
    writes: ['state'],
    calls: ['@jira-mgr/core/timer#pauseTimer'],
  },
  {
    path: ['timer', 'resume'],
    summary: 'Resume the timer',
    examples: [{ command: 'jm timer resume', description: 'Resume the paused timer.' }],
    output: { summary: 'The running timer.', example: TIMER_STATUS },
    exits: [{ code: 'not_found', when: 'No timer exists.' }],
    writes: ['state'],
    calls: ['@jira-mgr/core/timer#resumeTimer'],
  },

  // help (L1)
  {
    path: ['help'],
    summary: 'Show help for a command',
    description:
      'Prints help for a command. With `--json`, or when piped, it prints the help document: every command with its flags, examples, output and exit codes. Name a command to print only that command.',
    args: [
      {
        name: 'command',
        type: 'text',
        optional: true,
        variadic: true,
        description: 'A command path, such as `issue delete`.',
      },
    ],
    examples: [
      { command: 'jm help --json', description: 'Print every command as JSON.' },
      { command: 'jm help issue delete --json', description: 'Print one command as JSON.' },
    ],
    output: {
      summary: 'The help document, or one command object when a command is named.',
      example: { name: 'jm', version: '1.0.0', globalOptions: [], exitCodes: [], commands: [] },
    },
    exits: [{ code: 'validation_failed', when: 'The named command does not exist.' }],
    writes: [],
    calls: [],
  },
] as const satisfies readonly CommandSpec[]

// Types for handlers: a spec's input is typed from its schema.

type Spec = (typeof COMMANDS)[number]

type Join<P extends readonly string[]> = P extends readonly [
  infer H extends string,
  ...infer T extends readonly string[],
]
  ? T extends readonly []
    ? H
    : `${H} ${Join<T>}`
  : never

/** Every command's id, such as `issue delete`. */
export type CommandId = Join<Spec['path']>

/** The spec behind an id. */
export type SpecOf<Id extends CommandId> = Spec extends infer S
  ? S extends { path: infer P extends readonly string[] }
    ? Join<P> extends Id
      ? S
      : never
    : never
  : never

type Camel<S extends string> = S extends `${infer H}-${infer T}` ? `${H}${Capitalize<Camel<T>>}` : S

interface ValueOf {
  text: string
  markdown: string
  file: string
  'issue-key': string
  id: string
  date: string
  datetime: Date
  duration: string
  number: number
  integer: number
  enum: string
  boolean: boolean
}

type Base<T extends { type: ValueType }> = ValueOf[T['type']]

type ArgValue<A extends ArgSpec> = A extends { variadic: true }
  ? Base<A>[]
  : A extends { optional: true }
    ? Base<A> | undefined
    : Base<A>

type OptionValue<O extends OptionSpec> = O extends { type: 'boolean' }
  ? boolean
  : O extends { repeatable: true }
    ? Base<O>[]
    : | Base<O>
      | (O extends { clearable: true } ? null : never)
      | (O extends { required: true } | { default: string | number | boolean } ? never : undefined)

type ArgsInput<S extends CommandSpec> = S extends { args: infer As extends readonly ArgSpec[] }
  ? { [A in As[number] as Camel<A['name']>]: ArgValue<A> }
  : unknown

type OptionsInput<S extends CommandSpec> = S extends {
  options: infer Os extends readonly OptionSpec[]
}
  ? { [O in Os[number] as Camel<O['name']>]: OptionValue<O> }
  : unknown

/** The typed input a handler receives for a spec. Global options are not part of it. */
export type InputOf<S extends CommandSpec> = ArgsInput<S> & OptionsInput<S>
