import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { adfToMarkdown, markdownToAdf } from '@jira-mgr/core/adf'
import { loadFixture, usePsapacState } from '@jira-mgr/core/test/msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { COMMANDS } from '../../schema.js'
import { fakeSecurity } from '../../test-auth.js'
import { calls, forbidden, issueNotFound, serveExtras } from '../../test-extras.js'
import { runJson, runTty } from '../../test-read.js'
import { expectShape } from '../../test-shape.js'

const spec = (id: string) => COMMANDS.find((c) => c.path.join(' ') === id)

usePsapacState()

const KEY = 'PSAPAC-666'
const COMMENTS = `/rest/api/3/issue/${KEY}/comment`
const ONE = `${COMMENTS}/1521295`

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jm-comment-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('jm comment list', () => {
  it('lists the comments with each body as ADF and as Markdown', async () => {
    const requests = serveExtras()
    const { code, data, f } = await runJson(['comment', 'list', KEY])
    expect(code).toBe(0)
    expectShape(data, spec('comment list')?.output.example)
    const comments = data as { id: string; body: never; bodyMarkdown: string }[]
    expect(comments.map((c) => c.id)).toEqual(['1521295', '1539888', '1550451'])
    for (const c of comments) expect(c.bodyMarkdown).toBe(adfToMarkdown(c.body))
    expect(calls(requests)).toEqual([`GET ${COMMENTS}?startAt=0&maxResults=50`])
    expect(f.stderr).toBe('')
  })

  it('prints each comment under its id, author and time on a terminal', async () => {
    serveExtras()
    const { code, f, lines } = await runTty(['comment', 'list', KEY])
    expect(code).toBe(0)
    expect(lines[0]).toMatch(/^1521295 {2}Sharon Warner {2}\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    const recorded = loadFixture('comments-psapac-666') as unknown as {
      comments: { body: never }[]
    }
    expect(f.stdout).toContain(adfToMarkdown(recorded.comments[0]?.body as never))
    expect(f.stdout).toContain('1550451')
  })

  it('says so on stderr for an issue with no comments, and prints nothing on stdout', async () => {
    serveExtras(({ method, path }) =>
      method === 'GET' && path.startsWith(COMMENTS)
        ? Response.json({ total: 0, comments: [] })
        : undefined,
    )
    const { code, f } = await runTty(['comment', 'list', KEY])
    expect(code).toBe(0)
    expect(f.stdout).toBe('')
    expect(f.stderr).toBe('No comments.\n')
  })

  it('exits 3 for an issue that does not exist', async () => {
    serveExtras(issueNotFound)
    const { code, error } = await runJson(['comment', 'list', KEY])
    expect(code).toBe(3)
    expect(error?.code).toBe('not_found')
  })
})

describe('jm comment add', () => {
  it('turns Markdown into ADF in one POST', async () => {
    const requests = serveExtras()
    const { code, data, f } = await runJson(['comment', 'add', KEY, '--body', 'Checked **twice**.'])
    expect(code).toBe(0)
    expectShape(data, spec('comment add')?.output.example)
    expect(calls(requests)).toEqual([`POST ${COMMENTS}`])
    expect(requests[0]?.body).toEqual({
      body: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Checked ' },
              { type: 'text', text: 'twice', marks: [{ type: 'strong' }] },
              { type: 'text', text: '.' },
            ],
          },
        ],
      },
    })
    expect(f.stderr).toBe('')
  })

  it('reads Markdown from a file with --body-file', async () => {
    const requests = serveExtras()
    const file = join(dir, 'note.md')
    await writeFile(file, '- one\n- two\n')
    expect((await runJson(['comment', 'add', KEY, '--body-file', file])).code).toBe(0)
    expect(requests[0]?.body).toEqual({ body: markdownToAdf('- one\n- two\n') })
  })

  it('reads Markdown from stdin with --body-file -', async () => {
    const requests = serveExtras()
    const { code } = await runJson(['comment', 'add', KEY, '--body-file', '-'], undefined, {
      stdin: 'From stdin.',
    })
    expect(code).toBe(0)
    expect(requests[0]?.body).toEqual({ body: markdownToAdf('From stdin.') })
  })

  it('sends a raw ADF file as it is with --adf', async () => {
    const requests = serveExtras()
    const adf = markdownToAdf('Raw **ADF**')
    const file = join(dir, 'doc.json')
    await writeFile(file, JSON.stringify(adf))
    expect((await runJson(['comment', 'add', KEY, '--adf', file])).code).toBe(0)
    expect(requests[0]?.body).toEqual({ body: adf })
  })

  it('refuses an --adf file that is not an ADF document, before any request', async () => {
    const requests = serveExtras()
    const file = join(dir, 'bad.json')
    await writeFile(file, '{"type":"paragraph"}')
    const { code, error } = await runJson(['comment', 'add', KEY, '--adf', file])
    expect(code).toBe(2)
    expect(error?.code).toBe('validation_failed')
    expect(requests).toEqual([])
  })

  it('exits 2 with no body input, and with two, before any request', async () => {
    const requests = serveExtras()
    const none = await runJson(['comment', 'add', KEY])
    expect(none.code).toBe(2)
    expect(none.error?.message).toBe('Give one of --body, --body-file or --adf.')
    expect((await runJson(['comment', 'add', KEY, '--body', 'a', '--body-file', 'b'])).code).toBe(2)
    expect(requests).toEqual([])
  })

  it('prints the new comment id on a terminal', async () => {
    serveExtras()
    const { code, f } = await runTty(['comment', 'add', KEY, '--body', 'x'])
    expect(code).toBe(0)
    expect(f.stdout).toBe('Added comment 1521295\n')
  })

  it('exits 3 for an issue that does not exist', async () => {
    serveExtras(issueNotFound)
    expect((await runJson(['comment', 'add', KEY, '--body', 'x'])).code).toBe(3)
  })
})

describe('jm comment edit', () => {
  it('replaces the body with a PUT', async () => {
    const requests = serveExtras()
    const { code, data } = await runJson(['comment', 'edit', KEY, '1521295', '--body', 'Again.'])
    expect(code).toBe(0)
    expectShape(data, spec('comment edit')?.output.example)
    expect(calls(requests)).toEqual([`PUT ${ONE}`])
    expect(requests[0]?.body).toEqual({ body: markdownToAdf('Again.') })
  })

  it('prints the edited comment id on a terminal', async () => {
    serveExtras()
    const { f } = await runTty(['comment', 'edit', KEY, '1521295', '--body', 'x'])
    expect(f.stdout).toBe('Edited comment 1521295\n')
  })

  it('exits 2 with no body input, before any request', async () => {
    const requests = serveExtras()
    expect((await runJson(['comment', 'edit', KEY, '1521295'])).code).toBe(2)
    expect(requests).toEqual([])
  })

  it('exits 2 for a comment id that is not digits, before any request', async () => {
    const requests = serveExtras()
    expect((await runJson(['comment', 'edit', KEY, '12/../3', '--body', 'x'])).code).toBe(2)
    expect(requests).toEqual([])
  })

  it("maps the 403 on another user's comment to exit 4", async () => {
    serveExtras(({ method }) => (method === 'PUT' ? forbidden() : undefined))
    const { code, error } = await runJson(['comment', 'edit', KEY, '1521295', '--body', 'x'])
    expect(code).toBe(4)
    expect(error?.code).toBe('permission_denied')
  })

  it('exits 3 for a comment that does not exist', async () => {
    serveExtras(issueNotFound)
    expect((await runJson(['comment', 'edit', KEY, '1', '--body', 'x'])).code).toBe(3)
  })
})

describe('jm comment delete', () => {
  it('deletes without --confirm and reports the ids', async () => {
    const requests = serveExtras()
    const { code, data } = await runJson(['comment', 'delete', KEY, '1521295'])
    expect(code).toBe(0)
    expectShape(data, spec('comment delete')?.output.example)
    expect(data).toEqual({ key: KEY, commentId: '1521295' })
    expect(calls(requests)).toEqual([`DELETE ${ONE}`])
  })

  it('prints the result on a terminal', async () => {
    serveExtras()
    const { f } = await runTty(['comment', 'delete', KEY, '1521295'])
    expect(f.stdout).toBe(`Deleted comment 1521295 from ${KEY}\n`)
  })

  it("maps the 403 on another user's comment to exit 4, and prints jm: on a terminal", async () => {
    serveExtras(forbidden)
    expect((await runJson(['comment', 'delete', KEY, '1'])).code).toBe(4)
    const tty = await runTty(['comment', 'delete', KEY, '1'])
    expect(tty.code).toBe(4)
    expect(tty.f.stdout).toBe('')
    expect(tty.f.stderr).toMatch(/^jm: /)
  })

  it('exits 3 for a comment that does not exist', async () => {
    serveExtras(issueNotFound)
    expect((await runJson(['comment', 'delete', KEY, '1'])).code).toBe(3)
  })
})

describe('comment commands outside the project or logged out', () => {
  const foreign: [string, string[]][] = [
    ['add', ['comment', 'add', 'OTHER-5', '--body', 'x']],
    ['edit', ['comment', 'edit', 'OTHER-5', '1', '--body', 'x']],
    ['delete', ['comment', 'delete', 'OTHER-5', '1']],
  ]

  it.each(foreign)('%s refuses a key outside PSAPAC with no request', async (_name, argv) => {
    const requests = serveExtras()
    const { code, error } = await runJson(argv)
    expect(code).toBe(2)
    expect(error?.message).toBe('OTHER-5 is not in PSAPAC. jm manages the PSAPAC project only.')
    expect(requests).toEqual([])
  })

  const loggedOut: [string, string[]][] = [
    ['list', ['comment', 'list', KEY]],
    ['add', ['comment', 'add', KEY, '--body', 'x']],
    ['edit', ['comment', 'edit', KEY, '1', '--body', 'x']],
    ['delete', ['comment', 'delete', KEY, '1']],
  ]

  it.each(loggedOut)('%s exits 4 when logged out, before any request', async (_name, argv) => {
    const requests = serveExtras()
    const { code, error } = await runJson(argv, { keychain: fakeSecurity().keychain })
    expect(code).toBe(4)
    expect(error?.code).toBe('permission_denied')
    expect(requests).toEqual([])
  })
})
