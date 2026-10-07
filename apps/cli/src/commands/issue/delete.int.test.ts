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
