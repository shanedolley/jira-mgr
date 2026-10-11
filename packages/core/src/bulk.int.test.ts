import { HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import {
  failure,
  JIRA_SITE,
  loadFixture,
  noContent,
  serveRecorded,
  usePsapacState,
  type Recorded,
} from '../test/msw.js'
import { runBatch, type BatchChange, type BatchItem, type BatchProgress } from './bulk.js'
import { createHttpClient } from './http.js'

usePsapacState()

const client = createHttpClient({
  credentials: () => Promise.resolve({ siteUrl: JIRA_SITE, email: 'a@b.co', token: 'x' }),
  sleep: () => Promise.resolve(),
})

const noSleep = () => Promise.resolve()
const IN_PROGRESS = '11823'

const keys = (count: number, from = 100) =>
  Array.from({ length: count }, (_, i) => `PSAPAC-${String(from + i)}`)
/** The numeric id Jira's task results use for a key in these tests. */
const idOf = (key: string) => String(Number(key.split('-')[1]) + 900_000)
const item = (key: string, change: BatchChange): BatchItem => ({ key, id: idOf(key), change })
const all = (list: string[], change: BatchChange) => list.map((key) => item(key, change))
const status = (statusId = IN_PROGRESS): BatchChange => ({ kind: 'status', statusId })
const edit = (changes: Extract<BatchChange, { kind: 'edit' }>['changes']): BatchChange => ({
  kind: 'edit',
  changes,
})

const json = (body: unknown, init?: number) => HttpResponse.json(body as never, { status: init })
const queue = (list: string[], failed: Record<string, string[]> = {}) =>
  json({
    ...(loadFixture('bulk-queue-complete-fields') as object),
    totalIssueCount: list.length,
    processedAccessibleIssues: list
      .filter((key) => !(idOf(key) in failed))
      .map((k) => Number(idOf(k))),
    failedAccessibleIssues: failed,
  })
const running = json({ taskId: '1', status: 'RUNNING', progressPercent: 40 })
const transitionsFor = (...groups: { issues: string[]; statusIds: number[] }[]) =>
  json({
    availableTransitions: groups.map(({ issues, statusIds }) => ({
      transitions: statusIds.map((statusId) => ({
        transitionId: statusId - 11800,
        transitionName: 'Move',
        to: { statusId, statusName: 'Status' },
      })),
      issues,
      isTransitionsFiltered: false,
    })),
  })

/** Answers each request with the first route whose `METHOD path` starts the request's. */
function jira(routes: Record<string, (request: Recorded) => Response>): Recorded[] {
  return serveRecorded((request) => {
    const line = `${request.method} ${request.path.split('?')[0] ?? ''}`
    const route = Object.entries(routes).find(([prefix]) => line.startsWith(prefix))
    return route === undefined
      ? json({ errorMessages: [`no route for ${line}`] }, 404)
      : route[1](request)
  })
}
const to = (response: Response) => () => response.clone()
const errorWith = (status: number) => () =>
  json({ errorMessages: [`Jira says ${String(status)}`] }, status)

const BULK_FIELDS = 'POST /rest/api/3/bulk/issues/fields'
const BULK_TRANSITION = 'POST /rest/api/3/bulk/issues/transition'
const TRANSITIONS_GET = 'GET /rest/api/3/bulk/issues/transition'
const QUEUE = 'GET /rest/api/3/bulk/queue/'
const EDIT = 'PUT /rest/api/3/issue/'
const ISSUE_TRANSITIONS = 'GET /rest/api/3/issue/'

const paths = (requests: Recorded[]) => requests.map(({ method, path }) => `${method} ${path}`)
const only = (requests: Recorded[], prefix: string) =>
  requests.filter(({ method, path }) => `${method} ${path}`.startsWith(prefix))

describe('runBatch status', () => {
  it('replays the recorded transition request for two issues', async () => {
    const requests = jira({
      [TRANSITIONS_GET]: to(json(loadFixture('bulk-transitions-get'))),
      [BULK_TRANSITION]: to(json(loadFixture('bulk-transition-post-response'))),
      [QUEUE]: to(json(loadFixture('bulk-queue-complete-transition'))),
    })
    const batch = ['PSAPAC-3141', 'PSAPAC-3142'].map((key, i) => ({
      key,
      id: String(1454083 - i),
      change: status(),
    }))

    const outcome = await runBatch(client, batch, { sleep: noSleep })

    expect(outcome).toEqual({ done: ['PSAPAC-3141', 'PSAPAC-3142'], refused: [] })
    expect(only(requests, BULK_TRANSITION)[0]?.body).toEqual(
      loadFixture('bulk-transition-post-request'),
    )
    expect(paths(requests)[0]).toBe(
      'GET /rest/api/3/bulk/issues/transition?issueIdsOrKeys=PSAPAC-3141,PSAPAC-3142',
    )
  })

  it('moves ten issues with one read, one submit and the polls', async () => {
    const ten = keys(10)
    let polls = 0
    const requests = jira({
      [TRANSITIONS_GET]: to(transitionsFor({ issues: ten, statusIds: [11822, 11823] })),
      [BULK_TRANSITION]: to(json({ taskId: '777' })),
      [QUEUE]: () => (++polls === 1 ? running.clone() : queue(ten)),
    })

    const outcome = await runBatch(client, all(ten, status()), { sleep: noSleep })

    expect(outcome.done).toEqual(ten)
    expect(paths(requests).map((line) => line.split('?')[0])).toEqual([
      TRANSITIONS_GET,
      BULK_TRANSITION,
      `${QUEUE}777`,
      `${QUEUE}777`,
    ])
    expect(only(requests, BULK_TRANSITION)[0]?.body).toEqual({
      bulkTransitionInputs: [{ selectedIssueIdsOrKeys: ten, transitionId: '23' }],
      sendBulkNotification: false,
    })
  })

  it('sends one input per workflow that offers the status', async () => {
    const requests = jira({
      [TRANSITIONS_GET]: to(
        transitionsFor(
          { issues: ['PSAPAC-1', 'PSAPAC-2'], statusIds: [11823] },
          { issues: ['PSAPAC-3'], statusIds: [11822, 11823] },
        ),
      ),
      [BULK_TRANSITION]: to(json({ taskId: '5' })),
      [QUEUE]: to(queue(['PSAPAC-1', 'PSAPAC-2', 'PSAPAC-3'])),
    })

    await runBatch(client, all(['PSAPAC-1', 'PSAPAC-2', 'PSAPAC-3'], status()), {
      sleep: noSleep,
    })

    expect(only(requests, BULK_TRANSITION)[0]?.body).toMatchObject({
      bulkTransitionInputs: [
        { selectedIssueIdsOrKeys: ['PSAPAC-1', 'PSAPAC-2'], transitionId: '23' },
        { selectedIssueIdsOrKeys: ['PSAPAC-3'], transitionId: '23' },
      ],
    })
  })

  it('sends an issue with no bulk transition one by one and refuses it with what is open', async () => {
    const list = ['PSAPAC-1', 'PSAPAC-2', 'PSAPAC-3']
    const requests = jira({
      [TRANSITIONS_GET]: to(
        transitionsFor(
          { issues: ['PSAPAC-1', 'PSAPAC-2'], statusIds: [11823] },
          { issues: ['PSAPAC-3'], statusIds: [11855] },
        ),
      ),
      [BULK_TRANSITION]: to(json({ taskId: '5' })),
      [QUEUE]: to(queue(['PSAPAC-1', 'PSAPAC-2'])),
      [`${ISSUE_TRANSITIONS}PSAPAC-3/transitions`]: () => {
        const story = loadFixture('transitions-story') as {
          transitions: { to: { id: string } }[]
        }
        return json({
          transitions: story.transitions.filter(({ to }) => to.id !== IN_PROGRESS),
        })
      },
    })

    const outcome = await runBatch(client, all(list, status()), { sleep: noSleep })

    expect(outcome.done).toEqual(['PSAPAC-1', 'PSAPAC-2'])
    expect(outcome.refused).toHaveLength(1)
    expect(outcome.refused[0]?.key).toBe('PSAPAC-3')
    expect(outcome.refused[0]?.reason).toMatch(/Available: Hold, Review, To Do, Done\./)
    expect(only(requests, BULK_TRANSITION)[0]?.body).toMatchObject({
      bulkTransitionInputs: [{ selectedIssueIdsOrKeys: ['PSAPAC-1', 'PSAPAC-2'] }],
    })
  })

  it('moves a status-less group one by one when the bulk read answers 400 or 403', async () => {
    for (const code of [400, 403]) {
      const requests = jira({
        [TRANSITIONS_GET]: errorWith(code),
        [ISSUE_TRANSITIONS]: to(json(loadFixture('transitions-story'))),
        'POST /rest/api/3/issue/': () => noContent(),
      })

      const outcome = await runBatch(client, all(keys(3), status()), { sleep: noSleep })

      expect(outcome.done).toEqual(keys(3))
      expect(only(requests, 'POST /rest/api/3/issue/')).toHaveLength(3)
      expect(only(requests, 'POST /rest/api/3/bulk')).toHaveLength(0)
    }
  })

  it('refuses the group when the bulk read answers 500, with no call per issue', async () => {
    const requests = jira({ [TRANSITIONS_GET]: errorWith(500) })

    const outcome = await runBatch(client, all(keys(2), status()), { sleep: noSleep })

    expect(outcome.done).toEqual([])
    expect(outcome.refused.map(({ key }) => key)).toEqual(keys(2))
    expect(outcome.refused[0]?.reason).toContain('Jira answered 500')
    expect(requests).toHaveLength(1)
  })

  it('falls back per issue when the submit answers 400 or 403', async () => {
    for (const code of [400, 403]) {
      const list = keys(3)
      const requests = jira({
        [TRANSITIONS_GET]: to(transitionsFor({ issues: list, statusIds: [11823] })),
        [BULK_TRANSITION]: errorWith(code),
        [ISSUE_TRANSITIONS]: to(json(loadFixture('transitions-story'))),
        'POST /rest/api/3/issue/': () => noContent(),
      })

      const outcome = await runBatch(client, all(list, status()), { sleep: noSleep })

      expect(outcome.done).toEqual(list)
      expect(only(requests, 'POST /rest/api/3/issue/')).toHaveLength(3)
      expect(only(requests, QUEUE)).toHaveLength(0)
    }
  })
})

describe('runBatch edit', () => {
  it('replays the recorded fields request for priority and a label', async () => {
    const requests = jira({
      [BULK_FIELDS]: to(json(loadFixture('bulk-fields-post-response'))),
      [QUEUE]: to(json(loadFixture('bulk-queue-complete-fields'))),
    })
    const change = edit({ priorityId: '3', addLabels: ['jm-bulk-probe'] })
    const batch = [
      { key: 'PSAPAC-3141', id: '1454083', change },
      { key: 'PSAPAC-3142', id: '1454082', change },
    ]

    const outcome = await runBatch(client, batch, { sleep: noSleep })

    expect(outcome.done).toEqual(['PSAPAC-3141', 'PSAPAC-3142'])
    expect(only(requests, BULK_FIELDS)[0]?.body).toEqual(loadFixture('bulk-fields-post-request'))
  })

  it('sends assignee, Customer, Engagement and a label in the bulk shapes', async () => {
    const list = keys(2)
    const requests = jira({
      [BULK_FIELDS]: to(json({ taskId: '9' })),
      [QUEUE]: to(queue(list)),
    })

    const outcome = await runBatch(
      client,
      all(
        list,
        edit({
          assignee: 'acc-1',
          customerId: '10042',
          engagementId: '10043',
          removeLabels: ['old'],
        }),
      ),
      { sleep: noSleep },
    )

    expect(outcome.done).toEqual(list)
    expect(only(requests, BULK_FIELDS)[0]?.body).toEqual({
      editedFieldsInput: {
        singleSelectClearableUserPickerFields: [
          { fieldId: 'assignee', user: { accountId: 'acc-1' } },
        ],
        singleSelectFields: [
          { fieldId: 'customfield_14849', option: { optionId: 10042 } },
          { fieldId: 'customfield_14850', option: { optionId: 10043 } },
        ],
        labelsFields: [
          {
            bulkEditMultiSelectFieldOption: 'REMOVE',
            fieldId: 'labels',
            labels: [{ name: 'old' }],
          },
        ],
      },
      selectedActions: ['assignee', 'customfield_14849', 'customfield_14850', 'labels'],
      selectedIssueIdsOrKeys: list,
      sendBulkNotification: false,
    })
  })

  it('unassigns with a null user', async () => {
    const requests = jira({
      [BULK_FIELDS]: to(json({ taskId: '9' })),
      [QUEUE]: to(queue(['PSAPAC-1'])),
    })

    await runBatch(client, all(['PSAPAC-1'], edit({ assignee: null })), { sleep: noSleep })

    expect(only(requests, BULK_FIELDS)[0]?.body).toMatchObject({
      editedFieldsInput: {
        singleSelectClearableUserPickerFields: [{ fieldId: 'assignee', user: null }],
      },
    })
  })

  it('falls back per issue when the submit answers 400 or 403', async () => {
    for (const code of [400, 403]) {
      const list = keys(3)
      const requests = jira({ [BULK_FIELDS]: errorWith(code), [EDIT]: () => noContent() })

      const outcome = await runBatch(client, all(list, edit({ priorityId: '3' })), {
        sleep: noSleep,
      })

      expect(outcome.done).toEqual(list)
      // Five calls run at once, so they arrive in any order.
      expect(
        only(requests, EDIT)
          .map(({ path }) => path)
          .sort(),
      ).toEqual(list.map((key) => `/rest/api/3/issue/${key}`))
      expect(only(requests, EDIT)[0]?.body).toMatchObject({ fields: { priority: { id: '3' } } })
    }
  })

  it('refuses the group on a 500 or 401 and sends no call per issue', async () => {
    for (const code of [500, 401]) {
      const list = keys(3)
      const requests = jira({ [BULK_FIELDS]: errorWith(code), [EDIT]: () => noContent() })

      const outcome = await runBatch(client, all(list, edit({ priorityId: '3' })), {
        sleep: noSleep,
      })

      expect(outcome.done).toEqual([])
      expect(outcome.refused.map(({ key }) => key)).toEqual(list)
      expect(outcome.refused[0]?.reason).toContain(`Jira answered ${String(code)}`)
      expect(only(requests, EDIT)).toHaveLength(0)
    }
  })

  it('refuses a group whose task fails to poll, without a call per issue', async () => {
    const list = keys(2)
    const requests = jira({
      [BULK_FIELDS]: to(json({ taskId: '9' })),
      [QUEUE]: errorWith(400),
      [EDIT]: () => noContent(),
    })

    const outcome = await runBatch(client, all(list, edit({ priorityId: '3' })), {
      sleep: noSleep,
    })

    expect(outcome.refused.map(({ key }) => key)).toEqual(list)
    expect(only(requests, EDIT)).toHaveLength(0)
  })

  it("refuses a failed issue with Jira's message and one Jira skipped", async () => {
    const list = keys(3)
    jira({
      [BULK_FIELDS]: to(json({ taskId: '9' })),
      [QUEUE]: () =>
        json({
          ...(loadFixture('bulk-queue-complete-fields') as object),
          processedAccessibleIssues: [Number(idOf('PSAPAC-100'))],
          failedAccessibleIssues: { [idOf('PSAPAC-101')]: ['Priority is not on the screen.'] },
        }),
    })

    const outcome = await runBatch(client, all(list, edit({ priorityId: '3' })), {
      sleep: noSleep,
    })

    expect(outcome).toEqual({
      done: ['PSAPAC-100'],
      refused: [
        { key: 'PSAPAC-101', reason: 'Priority is not on the screen.' },
        { key: 'PSAPAC-102', reason: 'Jira skipped it.' },
      ],
    })
  })

  it('refuses the group when the task is still running after 120 seconds', async () => {
    const list = keys(2)
    const requests = jira({ [BULK_FIELDS]: to(json({ taskId: '9' })), [QUEUE]: to(running) })

    const outcome = await runBatch(client, all(list, edit({ priorityId: '3' })), {
      sleep: noSleep,
      pollMs: 1000,
    })

    expect(outcome.done).toEqual([])
    expect(outcome.refused[0]?.reason).toMatch(/still running task 9 after 120 seconds/)
    expect(only(requests, QUEUE)).toHaveLength(120)
  })

  it('sends fields the bulk endpoint lacks, and labels added with labels removed, one by one', async () => {
    const list = keys(2)
    const requests = jira({ [EDIT]: () => noContent() })

    const summary = await runBatch(client, all(list, edit({ summary: 'New' })), { sleep: noSleep })
    const both = await runBatch(
      client,
      all(list, edit({ addLabels: ['a'], removeLabels: ['b'] })),
      { sleep: noSleep },
    )

    expect(summary.done).toEqual(list)
    expect(both.done).toEqual(list)
    expect(requests.every(({ method }) => method === 'PUT')).toBe(true)
    expect(requests).toHaveLength(4)
  })

  it('sends Start date and Due date edits one by one, alone or with bulk fields', async () => {
    const list = keys(2)
    const requests = jira({ [EDIT]: () => noContent() })

    for (const changes of [
      { startDate: '2026-10-05' },
      { dueDate: null },
      { priorityId: '3', dueDate: '2026-10-09' },
    ]) {
      const outcome = await runBatch(client, all(list, edit(changes)), { sleep: noSleep })
      expect(outcome.done).toEqual(list)
    }

    expect(requests).toHaveLength(6)
    expect(requests.every(({ method }) => method === 'PUT')).toBe(true)
    expect(requests.map(({ body }) => JSON.stringify(body)).join()).toContain('"duedate":null')
  })

  it("records a failed per-issue call as that issue's refusal only", async () => {
    const list = keys(3)
    jira({
      [EDIT]: ({ path }) => (path.endsWith('-101') ? errorWith(400)() : noContent()),
    })

    const outcome = await runBatch(client, all(list, edit({ summary: 'New' })), { sleep: noSleep })

    expect(outcome.done).toEqual(['PSAPAC-100', 'PSAPAC-102'])
    expect(outcome.refused).toHaveLength(1)
    expect(outcome.refused[0]).toMatchObject({ key: 'PSAPAC-101' })
  })

  it('makes separate calls for separate changes and one for equal ones written in another key order', async () => {
    const requests = jira({
      [BULK_FIELDS]: to(json({ taskId: '9' })),
      [QUEUE]: () => queue(keys(4)),
    })
    const batch = [
      item('PSAPAC-100', edit({ priorityId: '3', addLabels: ['x'] })),
      item('PSAPAC-101', edit({ addLabels: ['x'], priorityId: '3' })),
      item('PSAPAC-102', edit({ priorityId: '4' })),
      item('PSAPAC-103', edit({ priorityId: '5' })),
    ]

    const outcome = await runBatch(client, batch, { sleep: noSleep })

    expect(outcome.done).toEqual(keys(4))
    const submits = only(requests, BULK_FIELDS).map(
      ({ body }) => body as { selectedIssueIdsOrKeys: string[] },
    )
    expect(submits.map((body) => body.selectedIssueIdsOrKeys)).toEqual([
      ['PSAPAC-100', 'PSAPAC-101'],
      ['PSAPAC-102'],
      ['PSAPAC-103'],
    ])
  })
})

describe('runBatch sprint', () => {
  it('moves issues into a sprint with one Agile call', async () => {
    const list = keys(3)
    const requests = jira({ 'POST /rest/agile/1.0/sprint/10171/issue': () => noContent() })

    const outcome = await runBatch(client, all(list, { kind: 'sprint', sprintId: 10171 }), {
      sleep: noSleep,
    })

    expect(outcome.done).toEqual(list)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.body).toEqual({ issues: list })
  })

  it('moves issues to the backlog, 50 at a time', async () => {
    const list = keys(120)
    const requests = jira({ 'POST /rest/agile/1.0/backlog/issue': () => noContent() })

    const outcome = await runBatch(client, all(list, { kind: 'sprint', sprintId: null }), {
      sleep: noSleep,
    })

    expect(outcome.done).toEqual(list)
    expect(requests.map(({ body }) => (body as { issues: string[] }).issues.length)).toEqual([
      50, 50, 20,
    ])
  })

  it('falls back per issue for a chunk that answers 400 or 403', async () => {
    for (const code of [400, 403]) {
      const list = keys(3)
      const requests = jira({
        'POST /rest/agile/1.0/sprint/10171/issue': ({ body }) =>
          (body as { issues: string[] }).issues.length > 1 ? errorWith(code)() : noContent(),
      })

      const outcome = await runBatch(client, all(list, { kind: 'sprint', sprintId: 10171 }), {
        sleep: noSleep,
      })

      expect(outcome.done).toEqual(list)
      expect(requests.map(({ body }) => (body as { issues: string[] }).issues.length)).toEqual([
        3, 1, 1, 1,
      ])
    }
  })

  it('refuses a chunk that answers 500 without a call per issue', async () => {
    const list = keys(3)
    const requests = jira({ 'POST /rest/agile/1.0/sprint/10171/issue': errorWith(500) })

    const outcome = await runBatch(client, all(list, { kind: 'sprint', sprintId: 10171 }), {
      sleep: noSleep,
    })

    expect(outcome.refused.map(({ key }) => key)).toEqual(list)
    expect(requests).toHaveLength(1)
  })
})

describe('runBatch progress and input', () => {
  it('reports progress after each per-issue call', async () => {
    jira({ [EDIT]: () => noContent() })
    const seen: BatchProgress[] = []

    await runBatch(client, all(keys(3), edit({ summary: 'New' })), {
      sleep: noSleep,
      onProgress: (progress) => seen.push(progress),
    })

    expect(seen).toEqual([
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ])
  })

  it('reports progress after each poll', async () => {
    const list = keys(4)
    let polls = 0
    jira({
      [BULK_FIELDS]: to(json({ taskId: '9' })),
      [QUEUE]: () => {
        polls++
        return polls < 3
          ? json({
              taskId: '9',
              status: 'RUNNING',
              processedAccessibleIssues: list.slice(0, polls).map((k) => Number(idOf(k))),
            })
          : queue(list)
      },
    })
    const seen: BatchProgress[] = []

    await runBatch(client, all(list, edit({ priorityId: '3' })), {
      sleep: noSleep,
      onProgress: (progress) => seen.push(progress),
    })

    expect(seen).toEqual([
      { done: 1, total: 4 },
      { done: 2, total: 4 },
      { done: 4, total: 4 },
    ])
  })

  it('waits pollMs between polls through the injected sleep', async () => {
    jira({ [BULK_FIELDS]: to(json({ taskId: '9' })), [QUEUE]: to(queue(['PSAPAC-1'])) })
    const waits: number[] = []

    await runBatch(client, all(['PSAPAC-1'], edit({ priorityId: '3' })), {
      sleep: (ms) => {
        waits.push(ms)
        return Promise.resolve()
      },
      pollMs: 250,
    })

    expect(waits).toEqual([250])
  })

  it('sends nothing for more than 1000 issues, a bad key, an empty edit or a repeated key', async () => {
    const requests = jira({})
    const bad: BatchItem[][] = [
      all(keys(1001), status()),
      [item('nope', status())],
      all(['PSAPAC-1'], edit({})),
      all(['PSAPAC-1'], edit({ priorityId: '' })),
      [...all(['PSAPAC-1'], status()), ...all(['PSAPAC-1'], status())],
      [{ key: 'PSAPAC-1', id: 'x', change: status() }],
      all(['PSAPAC-1'], { kind: 'sprint', sprintId: 0 }),
      all(['PSAPAC-1'], { kind: 'status', statusId: '' }),
    ]

    for (const batch of bad) {
      expect((await failure(runBatch(client, batch, { sleep: noSleep }))).code).toBe(
        'validation_failed',
      )
    }
    expect(requests).toHaveLength(0)
  })

  it('runs an empty batch with no request', async () => {
    const requests = jira({})

    expect(await runBatch(client, [])).toEqual({ done: [], refused: [] })
    expect(requests).toHaveLength(0)
  })

  it('rejects with the abort reason', async () => {
    jira({ [BULK_FIELDS]: to(json({ taskId: '9' })), [QUEUE]: to(running) })
    const controller = new AbortController()

    const result = runBatch(client, all(keys(2), edit({ priorityId: '3' })), {
      signal: controller.signal,
      sleep: () => {
        controller.abort(new Error('stop'))
        return Promise.reject(new Error('stop'))
      },
    })

    await expect(result).rejects.toThrow('stop')
  })
})
