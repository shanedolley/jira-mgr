import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { JIRA_SITE, loadFixture, server } from '../test/msw.js'
import { markdownToAdf } from './adf.js'
import { JiraMgrError } from './errors.js'
import { createHttpClient } from './http.js'
import { writeFields, writeSettings } from './state.js'
import {
  createIssue,
  deleteIssue,
  editIssue,
  transitionIssue,
  type CreateIssueInput,
  type EditIssueInput,
} from './write.js'

const IDS = {
  customer: 'customfield_14849',
  engagement: 'customfield_14850',
  sprint: 'customfield_10600',
  startDate: 'customfield_13808',
  timeRemaining: 'customfield_21785',
}

const client = createHttpClient({
  credentials: () => Promise.resolve({ siteUrl: JIRA_SITE, email: 'a@b.co', token: 'x' }),
})

interface Recorded {
  method: string
  path: string
  body: unknown
}

const noContent = () => new HttpResponse(null, { status: 204 })

/** Answers every call under /rest/ with `respond`, and returns what was sent. */
function serve(respond: (request: Recorded) => Response = noContent): Recorded[] {
  const requests: Recorded[] = []
  server.use(
    http.all(`${JIRA_SITE}/rest/*`, async ({ request }) => {
      const { pathname, search } = new URL(request.url)
      const text = await request.text()
      const recorded = {
        method: request.method,
        path: `${pathname}${search}`,
        body: text === '' ? undefined : (JSON.parse(text) as unknown),
      }
      requests.push(recorded)
      return respond(recorded)
    }),
  )
  return requests
}

async function failure(promise: Promise<unknown>): Promise<JiraMgrError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(JiraMgrError)
  return error as JiraMgrError
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jm-write-'))
  process.env.JM_STATE_DIR = dir
  await writeSettings({ siteUrl: JIRA_SITE, projectKey: 'PSAPAC' })
  await writeFields({
    site: JIRA_SITE,
    project: 'PSAPAC',
    resolvedAt: '2026-10-07T00:00:00.000Z',
    ids: IDS,
  })
})

afterEach(async () => {
  delete process.env.JM_STATE_DIR
  await rm(dir, { recursive: true, force: true })
})

const description = markdownToAdf('New text')

const base: CreateIssueInput = {
  type: 'Story',
  summary: 'Build it',
  customerId: '16451',
  engagementId: '22264',
}

const createdResponse = () =>
  HttpResponse.json({
    id: '1450001',
    key: 'PSAPAC-3200',
    self: `${JIRA_SITE}/rest/api/3/issue/1450001`,
  })

describe('createIssue', () => {
  it('posts every field in the shape Jira expects and returns the key and id', async () => {
    const requests = serve(createdResponse)
    const description = markdownToAdf('Hello **there**')

    const created = await createIssue(client, {
      ...base,
      parentKey: 'PSAPAC-3116',
      description,
      assignee: '712020:abc',
      priorityId: '4',
      labels: ['PSAPAC', 'cli'],
      startDate: '2026-10-08',
      dueDate: '2026-10-30',
      originalEstimate: '2h 30m',
      timeRemainingHours: 2.5,
    })

    expect(created).toEqual({ key: 'PSAPAC-3200', id: '1450001' })
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/rest/api/3/issue',
        body: {
          fields: {
            project: { key: 'PSAPAC' },
            issuetype: { name: 'Story' },
            summary: 'Build it',
            customfield_14849: { id: '16451' },
            customfield_14850: { id: '22264' },
            parent: { key: 'PSAPAC-3116' },
            description,
            assignee: { accountId: '712020:abc' },
            priority: { id: '4' },
            labels: ['PSAPAC', 'cli'],
            customfield_13808: '2026-10-08',
            duedate: '2026-10-30',
            timetracking: { originalEstimate: '2h 30m' },
            customfield_21785: 2.5,
          },
        },
      },
    ])
  })

  it.each(['Epic', 'Story', 'Task', 'Bug', 'Subtask'] as const)(
    'requires Customer and Engagement on a %s',
    async (type) => {
      const requests = serve(createdResponse)
      const parentKey = type === 'Subtask' ? 'PSAPAC-3119' : undefined
      const { customerId, engagementId, ...rest } = { ...base, type, parentKey }

      const noCustomer = await failure(
        createIssue(client, { ...rest, engagementId } as CreateIssueInput),
      )
      const noEngagement = await failure(
        createIssue(client, { ...rest, customerId } as CreateIssueInput),
      )
      const emptyCustomer = await failure(
        createIssue(client, { ...rest, engagementId, customerId: '' }),
      )

      expect(noCustomer.code).toBe('validation_failed')
      expect(noCustomer.message).toContain('Customer is required')
      expect(noEngagement.code).toBe('validation_failed')
      expect(noEngagement.message).toContain('Engagement is required')
      expect(emptyCustomer.message).toContain('Customer is required')
      expect(requests).toEqual([])
    },
  )

  it('requires a parent on a Subtask', async () => {
    const requests = serve(createdResponse)

    const error = await failure(createIssue(client, { ...base, type: 'Subtask' }))
    await createIssue(client, { ...base, type: 'Subtask', parentKey: 'PSAPAC-3119' })

    expect(error.code).toBe('validation_failed')
    expect(error.message).toContain('parentKey')
    expect(requests).toHaveLength(1)
  })

  it('refuses a field it does not know, a bad date and a label with a space before any request', async () => {
    const requests = serve(createdResponse)

    const unknown = await failure(
      createIssue(client, { ...base, status: 'Done' } as CreateIssueInput),
    )
    const badDate = await failure(createIssue(client, { ...base, dueDate: '30/10/2026' }))
    const badLabel = await failure(createIssue(client, { ...base, labels: ['two words'] }))

    expect([unknown.code, badDate.code, badLabel.code]).toEqual(Array(3).fill('validation_failed'))
    expect(badDate.message).toContain('dueDate')
    expect(requests).toEqual([])
  })

  it('leaves per-type fields to Jira: a 400 on a field the type lacks names that field', async () => {
    // Core does not check fields per type. A Bug has no Time remaining (h), so Jira refuses it.
    serve(() =>
      HttpResponse.json(
        { errors: { customfield_21785: 'Field cannot be set. It is not on the screen.' } },
        { status: 400 },
      ),
    )

    const error = await failure(
      createIssue(client, { ...base, type: 'Bug', timeRemainingHours: 2 }),
    )

    expect(error.code).toBe('validation_failed')
    expect(error.message).toContain('customfield_21785')
    expect(error.details).toMatchObject({
      errors: { customfield_21785: 'Field cannot be set. It is not on the screen.' },
    })
  })

  it('maps a Jira 400 to validation_failed naming the field', async () => {
    serve(() =>
      HttpResponse.json(
        { errors: { customfield_14849: 'Customer is required.' } },
        { status: 400 },
      ),
    )

    const error = await failure(createIssue(client, base))

    expect(error.code).toBe('validation_failed')
    expect(error.message).toContain('customfield_14849: Customer is required.')
  })

  it('maps a 403 to permission_denied and rejects an unexpected response body', async () => {
    serve(() => HttpResponse.json({ errorMessages: ['No.'] }, { status: 403 }))
    const denied = await failure(createIssue(client, base))
    server.resetHandlers()
    serve(() => HttpResponse.json({ nope: true }))
    const odd = await failure(createIssue(client, base))

    expect(denied.code).toBe('permission_denied')
    expect(odd.code).toBe('jira_error')
  })
})

describe('editIssue', () => {
  it.each<[string, EditIssueInput, Record<string, unknown>]>([
    ['summary', { summary: 'Renamed' }, { summary: 'Renamed' }],
    ['description', { description }, { description }],
    ['clearing the description', { description: null }, { description: null }],
    ['assignee', { assignee: '712020:abc' }, { assignee: { accountId: '712020:abc' } }],
    ['unassigning', { assignee: null }, { assignee: null }],
    ['priority', { priorityId: '2' }, { priority: { id: '2' } }],
    ['start date', { startDate: '2026-10-08' }, { customfield_13808: '2026-10-08' }],
    ['clearing the start date', { startDate: null }, { customfield_13808: null }],
    ['due date', { dueDate: '2026-10-30' }, { duedate: '2026-10-30' }],
    ['clearing the due date', { dueDate: null }, { duedate: null }],
    ['setting labels', { labels: ['a', 'b'] }, { labels: ['a', 'b'] }],
    ['clearing the labels', { labels: [] }, { labels: [] }],
    ['parent', { parentKey: 'PSAPAC-3116' }, { parent: { key: 'PSAPAC-3116' } }],
    ['Customer', { customerId: '16451' }, { customfield_14849: { id: '16451' } }],
    ['Engagement', { engagementId: '22264' }, { customfield_14850: { id: '22264' } }],
    ['Time remaining (h)', { timeRemainingHours: 1.5 }, { customfield_21785: 1.5 }],
    ['clearing Time remaining (h)', { timeRemainingHours: null }, { customfield_21785: null }],
    ['type', { type: 'Bug' }, { issuetype: { name: 'Bug' } }],
  ])('sends %s as one PUT with only that field', async (_name, input, fields) => {
    const requests = serve()

    await editIssue(client, 'PSAPAC-3119', input)

    expect(requests).toEqual([
      { method: 'PUT', path: '/rest/api/3/issue/PSAPAC-3119', body: { fields } },
    ])
  })

  it('sends several changed fields in one PUT', async () => {
    const requests = serve()

    await editIssue(client, 'PSAPAC-3119', { summary: 'Renamed', dueDate: null, customerId: '1' })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.body).toEqual({
      fields: { summary: 'Renamed', duedate: null, customfield_14849: { id: '1' } },
    })
  })

  it('adds and removes labels through update', async () => {
    const requests = serve()

    await editIssue(client, 'PSAPAC-3119', { addLabels: ['x', 'y'], removeLabels: ['z'] })

    expect(requests[0]?.body).toEqual({
      fields: {},
      update: { labels: [{ add: 'x' }, { add: 'y' }, { remove: 'z' }] },
    })
  })

  it('edits the original estimate through update so the remaining estimate stays', async () => {
    const requests = serve()

    await editIssue(client, 'PSAPAC-3119', { originalEstimate: '1w 2d 2h 30m' })

    expect(requests[0]?.body).toEqual({
      fields: {},
      update: { timetracking: [{ edit: { originalEstimate: '1w 2d 2h 30m' } }] },
    })
  })

  it('refuses empty label lists as nothing to change, and ignores them beside a change', async () => {
    const requests = serve()

    const error = await failure(
      editIssue(client, 'PSAPAC-3119', { addLabels: [], removeLabels: [] }),
    )
    await editIssue(client, 'PSAPAC-3119', { summary: 'x', addLabels: [] })

    expect(error.code).toBe('validation_failed')
    expect(error.message).toContain('Nothing to change')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.body).toEqual({ fields: { summary: 'x' } })
  })

  it('refuses setting labels together with adding or removing some', async () => {
    const requests = serve()

    const error = await failure(
      editIssue(client, 'PSAPAC-3119', { labels: ['a'], addLabels: ['b'] }),
    )

    expect(error.code).toBe('validation_failed')
    expect(requests).toEqual([])
  })

  it.each([['Story'], ['Task'], ['Bug']] as const)('allows a change to %s', async (type) => {
    const requests = serve()

    await editIssue(client, 'PSAPAC-3119', { type })

    expect(requests).toHaveLength(1)
  })

  it.each([['Epic'], ['Subtask'], ['Sub-task'], ['story']])(
    'refuses a change to %s before any request',
    async (type) => {
      const requests = serve()

      const error = await failure(editIssue(client, 'PSAPAC-3119', { type } as EditIssueInput))

      expect(error.code).toBe('validation_failed')
      expect(error.message).toContain('Story, Task and Bug')
      expect(requests).toEqual([])
    },
  )

  it('refuses an empty edit, a bad estimate, a bad key and an unknown field', async () => {
    const requests = serve()

    const errors = await Promise.all([
      failure(editIssue(client, 'PSAPAC-3119', {})),
      failure(editIssue(client, 'PSAPAC-3119', { originalEstimate: '2 hours' })),
      failure(editIssue(client, 'PSAPAC-3119/../x', { summary: 'x' })),
      failure(editIssue(client, 'PSAPAC-3119', { status: 'Done' } as EditIssueInput)),
    ])

    expect(errors.map((e) => e.code)).toEqual(Array(4).fill('validation_failed'))
    expect(errors[1].message).toContain('originalEstimate')
    expect(requests).toEqual([])
  })

  it('maps a Jira 400 to validation_failed and a 404 to not_found', async () => {
    serve(() => HttpResponse.json({ errors: { issuetype: 'Not allowed.' } }, { status: 400 }))
    const bad = await failure(editIssue(client, 'PSAPAC-3119', { type: 'Task' }))
    server.resetHandlers()
    serve(() => HttpResponse.json({ errorMessages: ['Issue does not exist.'] }, { status: 404 }))
    const missing = await failure(editIssue(client, 'PSAPAC-9', { summary: 'x' }))

    expect(bad.code).toBe('validation_failed')
    expect(bad.message).toContain('issuetype: Not allowed.')
    expect(missing.code).toBe('not_found')
  })

  it.each(['story', 'subtask', 'epic'])(
    'writes only fields the recorded %s editmeta allows',
    async (type) => {
      const meta = loadFixture(`editmeta-${type}`) as unknown as {
        fields: Record<string, { operations: string[] }>
      }
      const requests = serve()
      // Epic has no estimates, and Subtask no Start date, Time remaining or priority.
      const edits = {
        story: {
          summary: 's',
          description,
          assignee: 'a',
          priorityId: '1',
          startDate: '2026-10-08',
          dueDate: '2026-10-09',
          labels: ['a'],
          parentKey: 'PSAPAC-1',
          customerId: '1',
          engagementId: '1',
          originalEstimate: '1h',
          timeRemainingHours: 1,
        },
        subtask: {
          summary: 's',
          description,
          assignee: 'a',
          dueDate: '2026-10-09',
          labels: ['a'],
          parentKey: 'PSAPAC-1',
          customerId: '1',
          engagementId: '1',
          originalEstimate: '1h',
        },
        epic: {
          summary: 's',
          description,
          assignee: 'a',
          priorityId: '1',
          startDate: '2026-10-08',
          dueDate: '2026-10-09',
          labels: ['a'],
          customerId: '1',
          engagementId: '1',
        },
      }

      await editIssue(client, 'PSAPAC-1', edits[type as keyof typeof edits])
      await editIssue(client, 'PSAPAC-1', { addLabels: ['a'], removeLabels: ['b'] })

      const sent = Object.keys((requests[0]?.body as { fields: object }).fields)
      for (const key of sent) expect(meta.fields[key]?.operations, key).toContain('set')
      // Each `update` operation (add, remove, edit) must be one the type's editmeta lists.
      for (const { body } of requests) {
        const { update = {} } = body as { update?: Record<string, Record<string, unknown>[]> }
        for (const [key, ops] of Object.entries(update)) {
          for (const op of ops.flatMap(Object.keys)) {
            expect(meta.fields[key]?.operations, `${key} ${op}`).toContain(op)
          }
        }
      }
      expect(meta.fields.labels?.operations).toEqual(expect.arrayContaining(['add', 'remove']))
    },
  )
})

describe('malformed input', () => {
  const badKeys = [
    'PSAPAC-1/comment',
    'PSAPAC-1?x',
    'PSAPAC-1#x',
    'psapac-1',
    'PSAPAC-1\n',
    'PSAPAC-0',
    '',
  ]

  it.each(badKeys)(
    'refuses the key %j on edit, delete and transition with no request',
    async (key) => {
      const requests = serve()

      const errors = await Promise.all([
        failure(editIssue(client, key, { summary: 'x' })),
        failure(deleteIssue(client, key, { deleteSubtasks: false })),
        failure(transitionIssue(client, key, 'Done')),
      ])

      expect(errors.map((e) => e.code)).toEqual(Array(3).fill('validation_failed'))
      expect(requests).toEqual([])
    },
  )

  it('refuses a parentKey that is not a key', async () => {
    const requests = serve()

    const error = await failure(createIssue(client, { ...base, parentKey: 'PSAPAC-1/x' }))

    expect(error.code).toBe('validation_failed')
    expect(requests).toEqual([])
  })

  it.each([
    ['not an object', 'plain text'],
    ['a wrong version', { version: 2, type: 'doc', content: [] }],
    ['no content', { version: 1, type: 'doc' }],
    [
      'an inline node at the top',
      { version: 1, type: 'doc', content: [{ type: 'text', text: 'x' }] },
    ],
  ])('refuses a description that is %s on create and edit with no request', async (_name, bad) => {
    const requests = serve(createdResponse)

    const errors = await Promise.all([
      failure(
        createIssue(client, { ...base, description: bad as CreateIssueInput['description'] }),
      ),
      failure(
        editIssue(client, 'PSAPAC-3119', { description: bad as EditIssueInput['description'] }),
      ),
    ])

    expect(errors.map((e) => e.code)).toEqual(['validation_failed', 'validation_failed'])
    expect(errors[0].message).toContain('description')
    expect(requests).toEqual([])
  })
})

describe('deleteIssue', () => {
  it.each([true, false])('sends deleteSubtasks=%s', async (deleteSubtasks) => {
    const requests = serve()

    await deleteIssue(client, 'PSAPAC-3119', { deleteSubtasks })

    expect(requests).toEqual([
      {
        method: 'DELETE',
        path: `/rest/api/3/issue/PSAPAC-3119?deleteSubtasks=${String(deleteSubtasks)}`,
        body: undefined,
      },
    ])
  })

  it('refuses a missing or non-boolean flag before any request', async () => {
    const requests = serve()

    const missing = await failure(
      deleteIssue(client, 'PSAPAC-3119', {} as { deleteSubtasks: boolean }),
    )
    const text = await failure(
      deleteIssue(client, 'PSAPAC-3119', { deleteSubtasks: 'true' } as unknown as {
        deleteSubtasks: boolean
      }),
    )

    expect(missing.code).toBe('validation_failed')
    expect(missing.message).toContain('deleteSubtasks')
    expect(text.code).toBe('validation_failed')
    expect(requests).toEqual([])
  })

  it('maps a Jira 400 for an issue with subtasks to validation_failed', async () => {
    serve(() => HttpResponse.json({ errorMessages: ['The issue has subtasks.'] }, { status: 400 }))

    const error = await failure(deleteIssue(client, 'PSAPAC-3119', { deleteSubtasks: false }))

    expect(error.code).toBe('validation_failed')
    expect(error.message).toContain('has subtasks')
  })
})

describe('transitionIssue', () => {
  const serveTransitions = (fixture: string) =>
    serve(({ method }) =>
      method === 'GET' ? HttpResponse.json(loadFixture(fixture)) : noContent(),
    )

  it('posts the transition that reaches a status named in any case', async () => {
    const requests = serveTransitions('transitions-story')

    await transitionIssue(client, 'PSAPAC-3119', 'in progress')

    expect(requests).toEqual([
      { method: 'GET', path: '/rest/api/3/issue/PSAPAC-3119/transitions', body: undefined },
      {
        method: 'POST',
        path: '/rest/api/3/issue/PSAPAC-3119/transitions',
        body: { transition: { id: '21' } },
      },
    ])
  })

  it('posts the transition that reaches a status given by id', async () => {
    const requests = serveTransitions('transitions-story')

    const reached = await transitionIssue(client, 'PSAPAC-3119', '11824')

    expect(requests[1]?.body).toEqual({ transition: { id: '31' } })
    expect(reached).toBe('Done')
  })

  it('matches the status the transition reaches, not the transition name', async () => {
    // The recorded Epic transition 3 is named "REVIEW" and reaches the status "Review".
    const requests = serveTransitions('transitions-epic')

    await transitionIssue(client, 'PSAPAC-3116', 'Review')
    await transitionIssue(client, 'PSAPAC-3116', 'Opportunity')

    expect(requests.filter((r) => r.method === 'POST').map((r) => r.body)).toEqual([
      { transition: { id: '3' } },
      { transition: { id: '4' } },
    ])
  })

  it('refuses a status the issue cannot reach and lists the ones it can', async () => {
    const requests = serveTransitions('transitions-story')

    const error = await failure(transitionIssue(client, 'PSAPAC-3119', 'Opportunity'))

    expect(error.code).toBe('validation_failed')
    expect(error.message).toBe(
      'PSAPAC-3119 cannot move to "Opportunity". Available: Hold, Review, To Do, In Progress, Done.',
    )
    expect(error.details).toEqual({ available: ['Hold', 'Review', 'To Do', 'In Progress', 'Done'] })
    expect(requests.map((r) => r.method)).toEqual(['GET'])
  })

  it('rejects an unexpected transitions body and maps a 404', async () => {
    serve(() => HttpResponse.json({ transitions: [{ id: 3 }] }))
    const odd = await failure(transitionIssue(client, 'PSAPAC-3119', 'Done'))
    server.resetHandlers()
    serve(() => HttpResponse.json({ errorMessages: ['Issue does not exist.'] }, { status: 404 }))
    const missing = await failure(transitionIssue(client, 'PSAPAC-9', 'Done'))

    expect(odd.code).toBe('jira_error')
    expect(missing.code).toBe('not_found')
  })
})
