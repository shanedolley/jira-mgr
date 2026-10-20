import { loadFixture, usePsapacState } from '@jira-mgr/core/test/msw'
import { describe, expect, it } from 'vitest'

import { COMMANDS } from '../../schema.js'
import { fakeSecurity } from '../../test-auth.js'
import { runJson, runTty } from '../../test-read.js'
import { expectShape } from '../../test-shape.js'
import { serveWrites } from '../../test-write.js'

const spec = COMMANDS.find((c) => c.path.join(' ') === 'issue delete')

usePsapacState()

const KEY = 'PSAPAC-3066'
const ISSUE_PATH = `/rest/api/3/issue/${KEY}`

const recorded = () => loadFixture('issue-psapac-3066') as { fields: Record<string, unknown> }

/** The recorded issue, which has one subtask (PSAPAC-3122), or one with none. */
function serveDelete(options: { subtasks?: boolean } = {}) {
  const fixture = recorded()
  const issue =
    options.subtasks === false
      ? { ...fixture, fields: { ...fixture.fields, subtasks: [] } }
      : fixture
  return serveWrites({
    respond: ({ method, path }) =>
      method === 'GET' && path.startsWith(`${ISSUE_PATH}?`) ? Response.json(issue) : undefined,
  })
}

const del = (...args: string[]) => ['issue', 'delete', KEY, ...args]

/** The recorded issue as another key and type level, with no subtasks. */
function issueAt(key: string, hierarchyLevel: number) {
  const fixture = recorded() as { fields: { issuetype: object } }
  return {
    ...fixture,
    key,
    fields: {
      ...fixture.fields,
      issuetype: { ...fixture.fields.issuetype, hierarchyLevel, subtask: hierarchyLevel < 0 },
      subtasks: [],
    },
  }
}

const EPIC = 'PSAPAC-3001'
const STORY = 'PSAPAC-3002'
const SUBTASK = 'PSAPAC-3003'
const LEVELS: Record<string, number> = { [EPIC]: 1, [STORY]: 0, [SUBTASK]: -1 }

/** Serves an Epic, a Story and a Subtask, and answers a DELETE with `answer` (no content by default). */
function serveSet(answer?: (key: string) => Response | undefined) {
  return serveWrites({
    respond: ({ method, path }) => {
      const key = /issue\/(PSAPAC-\d+)/.exec(path)?.[1] ?? ''
      if (LEVELS[key] === undefined) return undefined
      return method === 'GET' ? Response.json(issueAt(key, LEVELS[key])) : answer?.(key)
    },
  })
}

const deleted = (requests: { method: string; path: string }[]) =>
  requests.filter((r) => r.method === 'DELETE').map((r) => r.path.split('?')[0]?.split('/').at(-1))

describe('jm issue delete with several keys', () => {
  const all = ['issue', 'delete', EPIC, STORY, SUBTASK, '--confirm']

  it('deletes the subtask, then the story, then the epic, and lists them in that order', async () => {
    const { requests } = serveSet()
    const { code, data, f } = await runJson(all)
    expect(code).toBe(0)
    expect(data).toEqual({
      deleted: [
        { key: SUBTASK, deletedSubtasks: [] },
        { key: STORY, deletedSubtasks: [] },
        { key: EPIC, deletedSubtasks: [] },
      ],
      failed: [],
    })
    expect(deleted(requests)).toEqual([SUBTASK, STORY, EPIC])
    expect(f.stderr).toBe(`Deleted ${SUBTASK}\nDeleted ${STORY}\nDeleted ${EPIC}\n`)
  })

  it('goes on after a refusal, names the failed key and exits with its code', async () => {
    const { requests } = serveSet((key) =>
      key === STORY
        ? Response.json({ errorMessages: ['No permission'] }, { status: 403 })
        : undefined,
    )
    const { code, data } = await runJson(all)
    expect(code).toBe(4)
    expect(data).toEqual({
      deleted: [
        { key: SUBTASK, deletedSubtasks: [] },
        { key: EPIC, deletedSubtasks: [] },
      ],
      failed: [
        { key: STORY, error: { code: 'permission_denied', message: expect.any(String) as string } },
      ],
    })
    expect(deleted(requests)).toEqual([SUBTASK, STORY, EPIC])
  })

  it('with --with-subtasks lists the Subtasks that went with each issue', async () => {
    serveSet()
    const { code, data } = await runJson([
      'issue',
      'delete',
      EPIC,
      KEY,
      '--confirm',
      '--with-subtasks',
    ])
    expect(code).toBe(0)
    // The Story goes before the Epic, and takes its recorded Subtask along.
    expect(data).toEqual({
      deleted: [
        { key: KEY, deletedSubtasks: ['PSAPAC-3122'] },
        { key: EPIC, deletedSubtasks: [] },
      ],
      failed: [],
    })
  })

  it('names each key on stderr as it settles, so a Ctrl-C part way still says what went', async () => {
    const controller = new AbortController()
    const { requests } = serveSet((key) => {
      if (key === EPIC) controller.abort()
      return undefined
    })
    const { code, f } = await runJson(all, undefined, { signal: controller.signal })
    expect(code).toBe(130)
    expect(f.stdout).toBe('')
    expect(f.stderr).toBe(`Deleted ${SUBTASK}\nDeleted ${STORY}\n`)
    // Ctrl-C landed while the Epic's delete was in flight, so it is the one key not reported.
    expect(deleted(requests)).toEqual([SUBTASK, STORY, EPIC])
  })

  it('prints each key to stderr and the count on a terminal, failures too', async () => {
    serveSet((key) =>
      key === EPIC ? Response.json({ errorMessages: ['boom'] }, { status: 500 }) : undefined,
    )
    const tty = await runTty(all)
    expect(tty.code).toBe(5)
    expect(tty.f.stdout).toBe('Deleted 2 issues, 1 failed\n')
    const lines = tty.f.stderr.split('\n')
    expect(lines.slice(0, 2)).toEqual([`Deleted ${SUBTASK}`, `Deleted ${STORY}`])
    expect(lines[2]).toMatch(new RegExp(`^Could not delete ${EPIC}: `))
  })

  it('refuses without --confirm, or with a key outside the project, before any request', async () => {
    const { requests } = serveSet()
    const bare = await runJson(['issue', 'delete', EPIC, STORY])
    expect(bare.code).toBe(2)
    expect(bare.error?.message).toBe(`Deleting ${EPIC}, ${STORY} is permanent. Pass --confirm.`)
    const foreign = await runJson(['issue', 'delete', EPIC, 'OTHER-1', '--confirm'])
    expect(foreign.code).toBe(2)
    expect(requests).toEqual([])
  })

  it('counts a repeated key once and keeps the one-key output', async () => {
    const { requests } = serveSet()
    const { code, data } = await runJson(['issue', 'delete', EPIC, EPIC, '--confirm'])
    expect(code).toBe(0)
    expect(data).toEqual({ key: EPIC, deletedSubtasks: [] })
    expect(deleted(requests)).toEqual([EPIC])
  })
})

describe('jm issue delete', () => {
  it('without --confirm exits 2 and sends no request', async () => {
    const { requests, meta } = serveDelete()
    const { code, error, f } = await runJson(del())
    expect(code).toBe(2)
    expect(error?.code).toBe('validation_failed')
    expect(error?.message).toBe(`Deleting ${KEY} is permanent. Pass --confirm.`)
    expect([requests, meta]).toEqual([[], []])
    const tty = await runTty(del('--with-subtasks'))
    expect(tty.code).toBe(2)
    expect(tty.f.stdout).toBe('')
    expect(tty.f.stderr).toBe(`jm: Deleting ${KEY} is permanent. Pass --confirm.\n`)
    expect(f.stderr).toBe('')
    expect([requests, meta]).toEqual([[], []])
  })

  it('with subtasks and no --with-subtasks exits 2 naming them, after only the read', async () => {
    const { requests } = serveDelete()
    const { code, error } = await runJson(del('--confirm'))
    expect(code).toBe(2)
    expect(error?.code).toBe('validation_failed')
    expect(error?.message).toBe(
      `${KEY} has subtasks PSAPAC-3122. Pass --with-subtasks to delete them too.`,
    )
    expect(error?.details).toEqual({ subtasks: ['PSAPAC-3122'] })
    expect(requests.map((r) => r.method)).toEqual(['GET'])
    expect(requests[0]?.path).toMatch(new RegExp(`^${ISSUE_PATH}\\?fields=`))
  })

  it('with --with-subtasks sends deleteSubtasks=true and lists the subtasks deleted', async () => {
    const { requests } = serveDelete()
    const { code, data, f } = await runJson(del('--confirm', '--with-subtasks'))
    expect(code).toBe(0)
    expectShape(data, spec?.output.example)
    expect(data).toEqual({ key: KEY, deletedSubtasks: ['PSAPAC-3122'] })
    expect(requests.map((r) => `${r.method} ${r.path.split('?')[0] ?? ''}`)).toEqual([
      `GET ${ISSUE_PATH}`,
      `DELETE ${ISSUE_PATH}`,
    ])
    expect(requests[1]?.path).toBe(`${ISSUE_PATH}?deleteSubtasks=true`)
    expect(f.stderr).toBe('')
  })

  it('deletes an issue with no subtasks and sends deleteSubtasks=false', async () => {
    const { requests } = serveDelete({ subtasks: false })
    const { code, data } = await runJson(del('--confirm'))
    expect(code).toBe(0)
    expect(data).toEqual({ key: KEY, deletedSubtasks: [] })
    expect(requests[1]).toMatchObject({
      method: 'DELETE',
      path: `${ISSUE_PATH}?deleteSubtasks=false`,
    })
  })

  it('with --with-subtasks and no subtasks sends deleteSubtasks=true and lists none', async () => {
    const { requests } = serveDelete({ subtasks: false })
    const { code, data } = await runJson(del('--confirm', '--with-subtasks'))
    expect(code).toBe(0)
    expect(data).toEqual({ key: KEY, deletedSubtasks: [] })
    expect(requests[1]?.path).toBe(`${ISSUE_PATH}?deleteSubtasks=true`)
  })

  it('prints the deletion on a terminal', async () => {
    serveDelete()
    const cascade = await runTty(del('--confirm', '--with-subtasks'))
    expect(cascade.f.stdout).toBe(`Deleted ${KEY} and its subtasks PSAPAC-3122\n`)
    serveDelete({ subtasks: false })
    const plain = await runTty(del('--confirm'))
    expect(plain.f.stdout).toBe(`Deleted ${KEY}\n`)
  })

  it('exits 3 for an issue that does not exist, and deletes nothing', async () => {
    const { requests } = serveWrites({
      respond: () => Response.json({ errorMessages: ['Issue does not exist'] }, { status: 404 }),
    })
    const { code, error } = await runJson(del('--confirm'))
    expect(code).toBe(3)
    expect(error?.code).toBe('not_found')
    expect(requests.map((r) => r.method)).toEqual(['GET'])
  })

  it('exits 4 when logged out, before any request', async () => {
    const { requests } = serveDelete()
    const { code, error } = await runJson(del('--confirm'), { keychain: fakeSecurity().keychain })
    expect(code).toBe(4)
    expect(error?.code).toBe('permission_denied')
    expect(requests).toEqual([])
  })

  it('exits 5 on a server error from the delete', async () => {
    serveWrites({
      respond: ({ method, path }) => {
        if (method === 'GET' && path.startsWith(`${ISSUE_PATH}?`)) {
          const fixture = recorded()
          return Response.json({ ...fixture, fields: { ...fixture.fields, subtasks: [] } })
        }
        return method === 'DELETE'
          ? Response.json({ errorMessages: ['boom'] }, { status: 500 })
          : undefined
      },
    })
    const { code, error } = await runJson(del('--confirm'))
    expect(code).toBe(5)
    expect(error?.code).toBe('jira_error')
  })
})
