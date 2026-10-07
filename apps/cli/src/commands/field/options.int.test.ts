import {
  serveCreatemeta,
  serveFixture,
  serveRecorded,
  usePsapacState,
} from '@jira-mgr/core/test/msw'
import { describe, expect, it } from 'vitest'

import { COMMANDS } from '../../schema.js'
import { fakeSecurity } from '../../test-auth.js'
import { runJson, runTty, serveReads } from '../../test-read.js'
import { expectShape } from '../../test-shape.js'

const spec = COMMANDS.find((c) => c.path.join(' ') === 'field options')

usePsapacState()

interface Option {
  id: string
  name: string
}

/** Answers the createmeta and statuses reads from the recorded PSAPAC fixtures. */
function serveMeta() {
  const requests = serveReads()
  serveCreatemeta()
  serveFixture('get', '/rest/api/3/project/PSAPAC/statuses', 'project-statuses')
  return requests
}

async function options(field: string): Promise<Option[]> {
  const { code, data } = await runJson(['field', 'options', field])
  expect(code).toBe(0)
  return data as Option[]
}

describe('jm field options', () => {
  it('lists the Customers as id and name, and matches the schema example', async () => {
    serveMeta()
    const { code, data, f } = await runJson(['field', 'options', 'customer'])
    expect(code).toBe(0)
    expectShape(data, spec?.output.example)
    const customers = data as Option[]
    expect(customers).toHaveLength(42)
    expect(customers).toContainEqual({ id: '16120', name: 'BHP' })
    expect(f.stderr).toBe('')
  })

  it('lists the Engagements', async () => {
    serveMeta()
    const engagements = await options('engagement')
    expect(engagements).toHaveLength(21)
    expect(engagements[0]).toEqual({ id: '16450', name: 'AI Governance' })
  })

  it('lists the project’s priorities, not every one on the site', async () => {
    serveMeta()
    const priorities = await options('priority')
    expect(priorities).toHaveLength(11)
    expect(priorities).toContainEqual({ id: '4', name: 'Minor' })
  })

  it('lists the issue types', async () => {
    serveMeta()
    expect((await options('issue-type')).map((t) => t.name)).toEqual([
      'Task',
      'Bug',
      'Story',
      'Epic',
      'Subtask',
    ])
  })

  it('lists each status once', async () => {
    serveMeta()
    const statuses = (await options('status')).map((s) => s.name)
    expect(statuses).toHaveLength(6)
    expect(new Set(statuses)).toEqual(
      new Set(['Opportunity', 'To Do', 'In Progress', 'Review', 'Hold', 'Done']),
    )
  })

  it('reads the field in any case', async () => {
    serveMeta()
    expect(await options('CUSTOMER')).toHaveLength(42)
    expect((await options('Issue-Type')).length).toBe(5)
  })

  it('prints a table of id and name on a terminal', async () => {
    serveMeta()
    const { code, lines, f } = await runTty(['field', 'options', 'priority'])
    expect(code).toBe(0)
    expect(lines[0]).toMatch(/^ID +NAME$/)
    expect(lines.find((l) => l.startsWith('4 '))).toMatch(/^4 +Minor$/)
    expect(lines).toHaveLength(13)
    expect(f.stderr).toBe('')
  })

  it('prints nothing to stdout and a note to stderr when the field has no values', async () => {
    serveRecorded(() => Response.json([]))
    const { code, f } = await runTty(['field', 'options', 'status'])
    expect(code).toBe(0)
    expect(f.stdout).toBe('')
    expect(f.stderr).toBe('No values.\n')
  })

  describe('failures', () => {
    it('exits 2 for a field that is not on the list, sending nothing', async () => {
      const requests = serveMeta()
      for (const field of ['labels', 'sprint']) {
        const { code, error } = await runJson(['field', 'options', field])
        expect(code).toBe(2)
        expect(error?.code).toBe('validation_failed')
      }
      expect((await runJson(['field', 'options'])).code).toBe(2)
      expect(requests).toEqual([])
    })

    it('exits 4 when logged out', async () => {
      const requests = serveMeta()
      const { code, error } = await runJson(['field', 'options', 'customer'], {
        keychain: fakeSecurity().keychain,
      })
      expect(code).toBe(4)
      expect(error?.code).toBe('permission_denied')
      expect(requests).toEqual([])
    })

    it('exits 5 on an error from the server', async () => {
      serveRecorded(() => Response.json({ errorMessages: ['boom'] }, { status: 500 }))
      const { code, error } = await runJson(['field', 'options', 'priority'])
      expect(code).toBe(5)
      expect(error?.code).toBe('jira_error')
    })
  })
})
