import { loadFixture, usePsapacState, type Recorded } from '@jira-mgr/core/test/msw'
import { describe, expect, it } from 'vitest'

import { COMMANDS } from '../../schema.js'
import { fakeSecurity } from '../../test-auth.js'
import { calls, issueNotFound, serveExtras } from '../../test-extras.js'
import { runJson, runTty } from '../../test-read.js'
import { expectShape } from '../../test-shape.js'

const spec = (id: string) => COMMANDS.find((c) => c.path.join(' ') === id)

usePsapacState()

const KEY = 'PSAPAC-666'
const LINKS = `/rest/api/3/issue/${KEY}?fields=issuelinks`

interface RecordedLink {
  id: string
  type: unknown
  outwardIssue?: unknown
  inwardIssue?: unknown
}
const recorded = () =>
  (loadFixture('issue-links-psapac-666') as unknown as { fields: { issuelinks: RecordedLink[] } })
    .fields.issuelinks

interface LinkTypeRow {
  id: string
  name: string
  inward: string
  outward: string
}
const typeNamed = (name: string) => {
  const found = (
    loadFixture('issuelinktype') as unknown as { issueLinkTypes: LinkTypeRow[] }
  ).issueLinkTypes.find((t) => t.name === name)
  if (found === undefined) throw new Error(`The recorded link types have no ${name}.`)
  return found
}

type Side = 'outwardIssue' | 'inwardIssue'

/**
 * A link of PSAPAC-666 as Jira lists it after an add. The recorded Blocks link 551838
 * (PSAPAC-666 blocks PSAPAC-664) is the template, with the type, side and other issue changed.
 */
const linkTo = (side: Side, id: string, type = 'Blocks', key = 'PSAPAC-664') => {
  const [template] = recorded()
  if (template === undefined) throw new Error('The recorded links are empty.')
  const { outwardIssue, ...rest } = template
  return { ...rest, id, type: typeNamed(type), [side]: { ...(outwardIssue as object), key } }
}

/** Serves the recorded links of PSAPAC-666 plus the ones given, as Jira lists them after an add. */
const listing =
  (...added: object[]) =>
  ({ method, path }: Recorded) =>
    method === 'GET' && path === LINKS
      ? Response.json({ fields: { issuelinks: [...recorded(), ...added] } })
      : undefined

const withNewLink = (side: Side, id: string, type?: string) => listing(linkTo(side, id, type))

describe('jm link list', () => {
  it('lists the links seen from the issue', async () => {
    const requests = serveExtras()
    const { code, data, f } = await runJson(['link', 'list', KEY])
    expect(code).toBe(0)
    expectShape(data, spec('link list')?.output.example)
    expect(
      (data as { id: string; direction: string; issue: { key: string } }[]).map((l) => [
        l.id,
        l.direction,
        l.issue.key,
      ]),
    ).toEqual([
      ['551838', 'outward', 'PSAPAC-664'],
      ['551839', 'outward', 'PSAPAC-663'],
      ['551840', 'outward', 'PSAPAC-669'],
    ])
    expect(calls(requests)).toEqual([`GET ${LINKS}`])
    expect(f.stderr).toBe('')
  })

  it('prints each link as the phrase and the other issue on a terminal', async () => {
    serveExtras()
    const { code, lines } = await runTty(['link', 'list', KEY])
    expect(code).toBe(0)
    expect(lines[0]).toMatch(/^ID +LINK +KEY +STATUS +SUMMARY$/)
    expect(lines[1]).toMatch(/^551838 {2}blocks {2}PSAPAC-664 {2}/)
  })

  it('reads an inward link as "is blocked by"', async () => {
    serveExtras(withNewLink('inwardIssue', '551999'))
    const { lines } = await runTty(['link', 'list', KEY])
    expect(lines[4]).toMatch(/^551999 {2}is blocked by {2}PSAPAC-664 {2}/)
  })

  it('says so on stderr for an issue with no links', async () => {
    serveExtras(({ method, path }) =>
      method === 'GET' && path === LINKS
        ? Response.json({ fields: { issuelinks: [] } })
        : undefined,
    )
    const { code, f } = await runTty(['link', 'list', KEY])
    expect(code).toBe(0)
    expect(f.stdout).toBe('')
    expect(f.stderr).toBe('No links.\n')
  })

  it('exits 3 for an issue that does not exist', async () => {
    serveExtras(issueNotFound)
    expect((await runJson(['link', 'list', KEY])).code).toBe(3)
  })
})

describe('jm link add', () => {
  it('"A blocks B" makes A the blocker: inwardIssue is A, as verified live', async () => {
    const requests = serveExtras(withNewLink('outwardIssue', '551999'))
    const { code, data, f } = await runJson(['link', 'add', KEY, 'blocks', 'PSAPAC-664'])
    expect(code).toBe(0)
    expectShape(data, spec('link add')?.output.example)
    expect(data).toEqual({
      id: '551999',
      type: 'Blocks',
      direction: 'outward',
      key: KEY,
      otherKey: 'PSAPAC-664',
    })
    expect(calls(requests)).toEqual([
      'GET /rest/api/3/issueLinkType',
      'POST /rest/api/3/issueLink',
      `GET ${LINKS}`,
    ])
    expect(requests[1]?.body).toEqual({
      type: { id: '10000' },
      inwardIssue: { key: KEY },
      outwardIssue: { key: 'PSAPAC-664' },
    })
    expect(f.stderr).toBe('')
  })

  it('"A is blocked by B" makes B the blocker: inwardIssue is B', async () => {
    const requests = serveExtras(withNewLink('inwardIssue', '552000'))
    const { code, data } = await runJson(['link', 'add', KEY, 'is blocked by', 'PSAPAC-664'])
    expect(code).toBe(0)
    expect(data).toEqual({
      id: '552000',
      type: 'Blocks',
      direction: 'inward',
      key: KEY,
      otherKey: 'PSAPAC-664',
    })
    expect(requests[1]?.body).toEqual({
      type: { id: '10000' },
      inwardIssue: { key: 'PSAPAC-664' },
      outwardIssue: { key: KEY },
    })
  })

  it('reads a type name, in any case, as the outward side', async () => {
    const requests = serveExtras(withNewLink('outwardIssue', '551999'))
    const { code, data } = await runJson(['link', 'add', 'psapac-666', 'BLOCKS', 'psapac-664'])
    expect(code).toBe(0)
    expect(data).toMatchObject({ type: 'Blocks', direction: 'outward' })
    const named = serveExtras(withNewLink('outwardIssue', '551999'))
    await runJson(['link', 'add', KEY, 'Blocks', 'PSAPAC-664'])
    expect(named[1]?.body).toEqual(requests[1]?.body)
  })

  it('treats a phrase that is the same both ways as outward, like "relates to"', async () => {
    const requests = serveExtras(withNewLink('outwardIssue', '551999'))
    await runJson(['link', 'add', KEY, 'relates to', 'PSAPAC-664'])
    expect(requests[1]?.body).toEqual({
      type: { id: '10003' },
      inwardIssue: { key: KEY },
      outwardIssue: { key: 'PSAPAC-664' },
    })
  })

  it.each([['Causes'], ['causes'], ['CAUSES']])(
    'a type name wins over another type\'s phrase: "%s" makes Causes, outward',
    async (name) => {
      const requests = serveExtras(withNewLink('outwardIssue', '551999', 'Causes'))
      const { code, data } = await runJson(['link', 'add', KEY, name, 'PSAPAC-664'])
      expect(code).toBe(0)
      expect(data).toEqual({
        id: '551999',
        type: 'Causes',
        direction: 'outward',
        key: KEY,
        otherKey: 'PSAPAC-664',
      })
      expect(requests[1]?.body).toEqual({
        type: { id: '10500' },
        inwardIssue: { key: KEY },
        outwardIssue: { key: 'PSAPAC-664' },
      })
    },
  )

  it('resolves Problem/Incident by name, which no other type shares', async () => {
    const requests = serveExtras(withNewLink('outwardIssue', '551999', 'Problem/Incident'))
    const { code } = await runJson(['link', 'add', KEY, 'Problem/Incident', 'PSAPAC-664'])
    expect(code).toBe(0)
    expect(requests[1]?.body).toMatchObject({ type: { id: '11075' } })
  })

  it('resolves Merged by name, though "merged into" is also a phrase of a Polaris type', async () => {
    const requests = serveExtras(withNewLink('outwardIssue', '551999', 'Merged'))
    const { code } = await runJson(['link', 'add', KEY, 'Merged', 'PSAPAC-664'])
    expect(code).toBe(0)
    expect(requests[1]?.body).toEqual({
      type: { id: '12175' },
      inwardIssue: { key: KEY },
      outwardIssue: { key: 'PSAPAC-664' },
    })
  })

  it('exits 2 for "merged into", which Merged and a Polaris type both use, and suggests a name', async () => {
    const requests = serveExtras()
    const { code, error } = await runJson(['link', 'add', KEY, 'merged into', 'PSAPAC-664'])
    expect(code).toBe(2)
    expect(error?.details).toEqual({
      types: [
        { id: '12175', name: 'Merged' },
        { id: '11003', name: 'Polaris merge work item link' },
      ],
    })
    expect(error?.message).toContain('Give a type name instead, such as "Merged"')
    expect(calls(requests)).toEqual(['GET /rest/api/3/issueLinkType'])
  })

  it('exits 2 listing the type names when an inward phrase matches more than one', async () => {
    const requests = serveExtras()
    const { code, error } = await runJson(['link', 'add', KEY, 'is caused by', 'PSAPAC-664'])
    expect(code).toBe(2)
    expect(error?.code).toBe('validation_failed')
    expect(error?.message).toBe(
      'More than one link type matches "is caused by": Causes, Problem/Incident. Give a type name instead, such as "Causes": it reads outward, so swap the two issues for the inward side.',
    )
    expect(error?.details).toEqual({
      types: [
        { id: '10500', name: 'Causes' },
        { id: '11075', name: 'Problem/Incident' },
      ],
    })
    expect(calls(requests)).toEqual(['GET /rest/api/3/issueLinkType'])
  })

  it('picks the new link by type, side and issue, ignoring higher ids that differ in one', async () => {
    serveExtras(
      listing(
        linkTo('outwardIssue', '551999'),
        linkTo('inwardIssue', '700000'), // the other side, same type, same issue
        linkTo('outwardIssue', '700001', 'Relates'), // another type, same side and issue
        linkTo('outwardIssue', '700002', 'Blocks', 'PSAPAC-777'), // another issue
      ),
    )
    const { code, data } = await runJson(['link', 'add', KEY, 'blocks', 'PSAPAC-664'])
    expect(code).toBe(0)
    expect(data).toMatchObject({ id: '551999' })
  })

  it('says the link was added, and not to retry, when reading the links back fails', async () => {
    const requests = serveExtras(({ method, path }) =>
      method === 'GET' && path === LINKS
        ? Response.json({ errorMessages: ['Boom'] }, { status: 503 })
        : undefined,
    )
    const { code, error } = await runJson(['link', 'add', KEY, 'blocks', 'PSAPAC-664'])
    expect(code).toBe(5)
    expect(error?.code).toBe('jira_error')
    expect(error?.message).toBe(
      `The link was added, but reading the links of ${KEY} failed. Run \`jm link list ${KEY}\` to find its id. Do not run link add again.`,
    )
    expect(error?.message).not.toMatch(/try again/i)
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(1)
  })

  it('exits 2 for a phrase that matches no type, with nothing written', async () => {
    const requests = serveExtras()
    const { code, error } = await runJson(['link', 'add', KEY, 'hugs', 'PSAPAC-664'])
    expect(code).toBe(2)
    expect(error?.message).toContain('No link type matches "hugs"')
    expect(calls(requests)).toEqual(['GET /rest/api/3/issueLinkType'])
  })

  it('exits 5 when the new link is not listed afterwards, naming the issue', async () => {
    serveExtras()
    const { code, error } = await runJson(['link', 'add', KEY, 'blocks', 'PSAPAC-999'])
    expect(code).toBe(5)
    expect(error?.code).toBe('jira_error')
    expect(error?.message).toContain(`jm link list ${KEY}`)
  })

  it('prints the sentence and the link id on a terminal', async () => {
    serveExtras(withNewLink('outwardIssue', '551999'))
    const out = await runTty(['link', 'add', KEY, 'blocks', 'PSAPAC-664'])
    expect(out.code).toBe(0)
    expect(out.f.stdout).toBe(`${KEY} blocks PSAPAC-664 (link 551999)\n`)
    serveExtras(withNewLink('inwardIssue', '552000'))
    const inward = await runTty(['link', 'add', KEY, 'Is Blocked By', 'PSAPAC-664'])
    expect(inward.f.stdout).toBe(`${KEY} is blocked by PSAPAC-664 (link 552000)\n`)
  })

  it('exits 3 when Jira says an issue does not exist', async () => {
    serveExtras(({ method, path }) =>
      method === 'POST' && path === '/rest/api/3/issueLink' ? issueNotFound() : undefined,
    )
    const { code, error } = await runJson(['link', 'add', KEY, 'blocks', 'PSAPAC-664'])
    expect(code).toBe(3)
    expect(error?.code).toBe('not_found')
  })
})

describe('jm link remove', () => {
  it('reads the link, then deletes it by id, without --confirm', async () => {
    const requests = serveExtras()
    const { code, data } = await runJson(['link', 'remove', '551838'])
    expect(code).toBe(0)
    expectShape(data, spec('link remove')?.output.example)
    expect(data).toEqual({ linkId: '551838' })
    expect(calls(requests)).toEqual([
      'GET /rest/api/3/issueLink/551838',
      'DELETE /rest/api/3/issueLink/551838',
    ])
  })

  it('prints the result on a terminal', async () => {
    serveExtras()
    const { f } = await runTty(['link', 'remove', '551838'])
    expect(f.stdout).toBe('Removed link 551838\n')
  })

  const joining =
    (inward: string, outward: string) =>
    ({ method, path }: Recorded) => {
      if (method !== 'GET' || !path.startsWith('/rest/api/3/issueLink/')) return undefined
      const link = loadFixture('issue-link-551838') as unknown as {
        inwardIssue: object
        outwardIssue: object
      }
      return Response.json({
        ...link,
        inwardIssue: { ...link.inwardIssue, key: inward },
        outwardIssue: { ...link.outwardIssue, key: outward },
      })
    }

  it.each([
    ['the outward issue', 'PSAPAC-666', 'OTHER-5'],
    ['the inward issue', 'OTHER-5', 'PSAPAC-664'],
  ])(
    'refuses a link whose %s is outside PSAPAC, sending only the read',
    async (_n, inward, outward) => {
      const requests = serveExtras(joining(inward, outward))
      const { code, error } = await runJson(['link', 'remove', '551838'])
      expect(code).toBe(2)
      expect(error?.code).toBe('validation_failed')
      expect(error?.message).toBe('OTHER-5 is not in PSAPAC. jm manages the PSAPAC project only.')
      expect(calls(requests)).toEqual(['GET /rest/api/3/issueLink/551838'])
    },
  )

  it('exits 3 for a link that does not exist, after the read', async () => {
    const requests = serveExtras(issueNotFound)
    expect((await runJson(['link', 'remove', '1'])).code).toBe(3)
    expect(calls(requests)).toEqual(['GET /rest/api/3/issueLink/1'])
  })

  it('exits 2 for an id that is not digits, before any request', async () => {
    const requests = serveExtras()
    expect((await runJson(['link', 'remove', '12/../3'])).code).toBe(2)
    expect(requests).toEqual([])
  })
})

describe('link commands outside the project or logged out', () => {
  const foreign: [string, string[]][] = [
    ['the first key', ['link', 'add', 'OTHER-5', 'blocks', KEY]],
    ['the other key', ['link', 'add', KEY, 'blocks', 'OTHER-5']],
  ]

  it.each(foreign)('add refuses %s outside PSAPAC with no request', async (_name, argv) => {
    const requests = serveExtras()
    const { code, error } = await runJson(argv)
    expect(code).toBe(2)
    expect(error?.message).toBe('OTHER-5 is not in PSAPAC. jm manages the PSAPAC project only.')
    expect(requests).toEqual([])
  })

  const loggedOut: [string, string[]][] = [
    ['list', ['link', 'list', KEY]],
    ['add', ['link', 'add', KEY, 'blocks', 'PSAPAC-664']],
    ['remove', ['link', 'remove', '1']],
  ]

  it.each(loggedOut)('%s exits 4 when logged out, before any request', async (_name, argv) => {
    const requests = serveExtras()
    const { code, error } = await runJson(argv, { keychain: fakeSecurity().keychain })
    expect(code).toBe(4)
    expect(error?.code).toBe('permission_denied')
    expect(requests).toEqual([])
  })
})
