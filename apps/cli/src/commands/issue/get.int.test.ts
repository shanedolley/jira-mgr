import { adfToMarkdown } from '@jira-mgr/core/adf'
import {
  JIRA_SITE,
  loadFixture,
  serveRecorded,
  usePsapacState,
  type Recorded,
} from '@jira-mgr/core/test/msw'
import { writeFields, writeSettings } from '@jira-mgr/core/state'
import { describe, expect, it } from 'vitest'

import { COMMANDS } from '../../schema.js'
import { fakeSecurity } from '../../test-auth.js'
import { runJson, runTty } from '../../test-read.js'
import { expectShape } from '../../test-shape.js'

const spec = COMMANDS.find((c) => c.path.join(' ') === 'issue get')

usePsapacState()

const recorded = () => loadFixture('issue-psapac-3066') as { fields: Record<string, unknown> }

/** Answers the issue read with `body`, and returns the requests. */
function serveIssue(body: unknown = recorded(), status = 200): Recorded[] {
  return serveRecorded(() => Response.json(body, { status }))
}

const withFields = (fields: Record<string, unknown>) => ({
  ...recorded(),
  fields: { ...recorded().fields, ...fields },
})

interface Data {
  key: string
  description: { type: string } | null
  descriptionMarkdown: string | null
  subtasks: { key: string; summary: string; status: string }[]
  url: string
}

describe('jm issue get as JSON', () => {
  it('carries the issue, the ADF and Markdown descriptions, the subtasks and the URL', async () => {
    const requests = serveIssue(withFields({ comment: { comments: [], total: 3 } }))
    const { code, data, f } = await runJson(['issue', 'get', 'PSAPAC-3066'])
    expect(code).toBe(0)
    const issue = data as Data
    expectShape(issue, spec?.output.example)
    expect(issue).toMatchObject({
      key: 'PSAPAC-3066',
      status: { name: 'Done', category: 'done' },
      customer: { value: 'BHP' },
      parentKey: 'PSAPAC-2832',
      subtasks: [{ key: 'PSAPAC-3122', summary: 'test', status: 'To Do' }],
      url: `${JIRA_SITE}/browse/PSAPAC-3066`,
    })
    expect(issue.description).toEqual(recorded().fields.description)
    expect(issue.descriptionMarkdown).toBe(adfToMarkdown(issue.description))
    expect(issue.descriptionMarkdown).toMatch(/^- Data Domain Owners Forum, Tuesday 6 Oct 2026\.$/m)
    expect(issue.descriptionMarkdown).toContain('Done when both forums have run.')
    expect(f.stderr).toBe('')
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: 'GET' })
    expect(requests[0]?.path).toMatch(/^\/rest\/api\/3\/issue\/PSAPAC-3066\?fields=summary,/)
  })

  it('carries the comment count Jira sends, and no comment bodies', async () => {
    serveIssue(
      withFields({ comment: { comments: [{ id: '1', body: 'x' }], total: 3, startAt: 0 } }),
    )
    const { code, data } = await runJson(['issue', 'get', 'PSAPAC-3066'])
    expect(code).toBe(0)
    expect(data).toMatchObject({ key: 'PSAPAC-3066', commentCount: 3 })
    expect(data).not.toHaveProperty('comment')
  })

  it('reads a key in any case as upper case', async () => {
    const requests = serveIssue()
    const { code, data } = await runJson(['issue', 'get', 'psapac-3066'])
    expect(code).toBe(0)
    expect((data as Data).key).toBe('PSAPAC-3066')
    expect(requests[0]?.path).toContain('/issue/PSAPAC-3066?')
  })

  it('carries null, not a missing key, when the description key is absent', async () => {
    const fields = Object.fromEntries(
      Object.entries(recorded().fields).filter(([key]) => key !== 'description'),
    )
    serveIssue({ ...recorded(), fields })
    const { code, f } = await runJson(['issue', 'get', 'PSAPAC-3066'])
    expect(code).toBe(0)
    expect(f.stdout).toContain('"description":null')
    expect(f.stdout).toContain('"descriptionMarkdown":null')
  })

  it('carries null for an issue with no description and an empty list for no subtasks', async () => {
    serveIssue(withFields({ description: null, subtasks: [] }))
    const { data } = await runJson(['issue', 'get', 'PSAPAC-3066'])
    expect(data).toMatchObject({ description: null, descriptionMarkdown: null, subtasks: [] })
  })
})

describe('jm issue get on a terminal', () => {
  it('prints the fields, the subtasks and the description as Markdown', async () => {
    serveIssue()
    const { code, lines, f } = await runTty(['issue', 'get', 'PSAPAC-3066'])
    expect(code).toBe(0)
    expect(lines[0]).toBe(`PSAPAC-3066  ${(recorded().fields as { summary: string }).summary}`)
    const text = f.stdout
    expect(text).toMatch(/^Type: +Story$/m)
    expect(text).toMatch(/^Status: +Done$/m)
    expect(text).toMatch(/^Customer: +BHP$/m)
    expect(text).toMatch(/^Parent: +PSAPAC-2832$/m)
    expect(text).toMatch(
      /^URL: +https:\/\/engineering-collibra\.atlassian\.net\/browse\/PSAPAC-3066$/m,
    )
    expect(text).toMatch(/^KEY +STATUS +SUMMARY$/m)
    expect(text).toMatch(/^PSAPAC-3122 +To Do +test$/m)
    const description = text.slice(text.indexOf('Description\n'))
    expect(description).toContain('- Data Domain Owners Forum, Tuesday 6 Oct 2026.')
    expect(description).toContain('- Minerals Americas forum, Wednesday morning, 7 Oct 2026.')
    expect(description.trimEnd().endsWith('Done when both forums have run.')).toBe(true)
    expect(f.stderr).toBe('')
  })

  it('omits the fields an issue has no value for', async () => {
    serveIssue(withFields({ duedate: null }))
    const { f } = await runTty(['issue', 'get', 'PSAPAC-3066'])
    expect(f.stdout).not.toMatch(/^Due date:/m)
    expect(f.stdout).not.toMatch(/^Start date:/m)
    expect(f.stdout).toMatch(/^Labels: +PSAPAC$/m)
  })

  it('says so when there is no description and leaves out the Subtasks section for none', async () => {
    serveIssue(withFields({ description: null, subtasks: [] }))
    const { f } = await runTty(['issue', 'get', 'PSAPAC-3066'])
    expect(f.stdout).toContain('Description\n\nNo description.')
    expect(f.stdout).not.toContain('Subtasks')
  })

  it('colours the status by category, and not under NO_COLOR', async () => {
    serveIssue()
    const colour = await runTty(['issue', 'get', 'PSAPAC-3066'], { env: { FORCE_COLOR: '1' } })
    expect(colour.f.stdout).toContain('\u001b[32mDone\u001b[39m')
    serveIssue()
    const plain = await runTty(['issue', 'get', 'PSAPAC-3066'])
    expect(plain.f.stdout).not.toContain('\u001b')
  })

  it('strips control characters from the summary and the description', async () => {
    serveIssue(
      withFields({
        summary: 'Fix\u001b]0;pwned\u0007 it',
        description: {
          type: 'doc',
          version: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi\u001bc there' }] }],
        },
      }),
    )
    const { f } = await runTty(['issue', 'get', 'PSAPAC-3066'])
    expect(f.stdout).not.toMatch(/\p{Cc}(?<!\n)/u)
    expect(f.stdout).toContain('PSAPAC-3066  Fix]0;pwned it')
    expect(f.stdout).toContain('Hic there')
  })
})

describe('jm issue get failures', () => {
  it('exits 3 for an unknown issue', async () => {
    serveIssue({ errorMessages: ['Issue does not exist or you do not have permission.'] }, 404)
    const { code, error } = await runJson(['issue', 'get', 'PSAPAC-99999'])
    expect(code).toBe(3)
    expect(error?.code).toBe('not_found')
  })

  it('prints jm: and nothing on stdout for an unknown issue on a terminal', async () => {
    serveIssue({ errorMessages: ['nope'] }, 404)
    const { code, f } = await runTty(['issue', 'get', 'PSAPAC-99999'])
    expect(code).toBe(3)
    expect(f.stdout).toBe('')
    expect(f.stderr).toMatch(/^jm: /)
  })

  it('exits 2 for a malformed key before any request', async () => {
    const requests = serveIssue()
    for (const key of ['3066', 'PSAPAC', 'PSAPAC-0']) {
      expect((await runJson(['issue', 'get', key])).code).toBe(2)
    }
    expect((await runJson(['issue', 'get'])).code).toBe(2)
    expect(requests).toEqual([])
  })

  it('exits 2 when the site in settings is not an Atlassian Cloud site', async () => {
    serveIssue()
    // Fields resolved for the same site, so core's own mismatch check passes and the command's runs.
    const site = 'https://evil.example.com'
    await writeSettings({ siteUrl: site, projectKey: 'PSAPAC' })
    await writeFields({
      site,
      project: 'PSAPAC',
      resolvedAt: '2026-10-07T00:00:00.000Z',
      ids: {
        customer: 'customfield_14849',
        engagement: 'customfield_14850',
        sprint: 'customfield_10600',
        startDate: 'customfield_13808',
        timeRemaining: 'customfield_21785',
      },
    })
    const { code, error, f } = await runJson(['issue', 'get', 'PSAPAC-3066'])
    expect(code).toBe(2)
    expect(error?.code).toBe('validation_failed')
    expect(f.stdout).not.toContain('browse')
  })

  it('exits 4 when logged out', async () => {
    const requests = serveIssue()
    const { code, error } = await runJson(['issue', 'get', 'PSAPAC-3066'], {
      keychain: fakeSecurity().keychain,
    })
    expect(code).toBe(4)
    expect(error?.code).toBe('permission_denied')
    expect(requests).toEqual([])
  })

  it('exits 5 on an error from the server', async () => {
    serveIssue({ errorMessages: ['boom'] }, 500)
    const { code, error } = await runJson(['issue', 'get', 'PSAPAC-3066'])
    expect(code).toBe(5)
    expect(error?.code).toBe('jira_error')
  })

  it('exits 5 when the description is not an ADF document', async () => {
    serveIssue(withFields({ description: 'plain text' }))
    const { code, error } = await runJson(['issue', 'get', 'PSAPAC-3066'])
    expect(code).toBe(5)
    expect(error?.code).toBe('jira_error')
  })
})
