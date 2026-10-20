import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { usePsapacState, type Recorded } from '@jira-mgr/core/test/msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { COMMANDS } from '../../schema.js'
import { fakeSecurity } from '../../test-auth.js'
import { calls, issueNotFound, serveExtras } from '../../test-extras.js'
import { runJson, runTty } from '../../test-read.js'
import { expectShape } from '../../test-shape.js'

const spec = (id: string) => COMMANDS.find((c) => c.path.join(' ') === id)

usePsapacState()

const KEY = 'PSAPAC-3017'
const UPLOAD = `/rest/api/3/issue/${KEY}/attachments`
const META = 'GET /rest/api/3/attachment/meta'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jm-attach-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const file = async (name: string, content: string) => {
  const path = join(dir, name)
  await writeFile(path, content)
  return path
}

const limit =
  (uploadLimit: number, enabled = true) =>
  ({ method, path }: Recorded) =>
    method === 'GET' && path === '/rest/api/3/attachment/meta'
      ? Response.json({ enabled, uploadLimit })
      : undefined

describe('jm attach list', () => {
  it('lists the attachments with their ids', async () => {
    const requests = serveExtras()
    const { code, data, f } = await runJson(['attach', 'list', KEY])
    expect(code).toBe(0)
    expectShape(data, spec('attach list')?.output.example)
    expect((data as { id: string }[]).map((a) => a.id)).toHaveLength(2)
    expect(calls(requests)).toEqual([`GET /rest/api/3/issue/${KEY}?fields=attachment`])
    expect(f.stderr).toBe('')
  })

  it('prints a table on a terminal', async () => {
    serveExtras()
    const { code, lines } = await runTty(['attach', 'list', KEY])
    expect(code).toBe(0)
    expect(lines[0]).toMatch(/^ID +BYTES +AUTHOR +CREATED +FILENAME$/)
    expect(lines[1]).toMatch(/^652124 +\d+ +.+\d{4}-\d{2}-\d{2} \d{2}:\d{2} {2}1f4a1\.png$/)
  })

  it('says so on stderr for an issue with no attachments', async () => {
    serveExtras(({ method, path }) =>
      method === 'GET' && path.endsWith('?fields=attachment')
        ? Response.json({ fields: { attachment: [] } })
        : undefined,
    )
    const { code, f } = await runTty(['attach', 'list', KEY])
    expect(code).toBe(0)
    expect(f.stdout).toBe('')
    expect(f.stderr).toBe('No attachments.\n')
  })

  it('exits 3 for an issue that does not exist', async () => {
    serveExtras(issueNotFound)
    expect((await runJson(['attach', 'list', KEY])).code).toBe(3)
  })
})

describe('jm attach add', () => {
  it('uploads the file as multipart under its own name, after reading the site limit', async () => {
    const requests = serveExtras()
    const path = await file('notes.txt', 'hello notes')
    const { code, data, f } = await runJson(['attach', 'add', KEY, path])
    expect(code).toBe(0)
    expectShape(data, spec('attach add')?.output.example)
    expect(calls(requests)).toEqual([META, `POST ${UPLOAD}`])
    const form = requests[1]?.body as FormData
    const sent = form.get('file') as File
    expect([...form.keys()]).toEqual(['file'])
    expect(sent.name).toBe('notes.txt')
    expect(await sent.text()).toBe('hello notes')
    expect(requests[1]?.headers.get('x-atlassian-token')).toBe('no-check')
    expect(f.stderr).toBe('')
  })

  it('uploads several files in order, one request each, and returns every attachment', async () => {
    const requests = serveExtras()
    const a = await file('a.txt', 'A')
    const b = await file('b.bin', 'BB')
    const { code, data } = await runJson(['attach', 'add', KEY, a, b])
    expect(code).toBe(0)
    expect(data).toHaveLength(2)
    expect(calls(requests)).toEqual([META, `POST ${UPLOAD}`, `POST ${UPLOAD}`])
    const names = requests
      .filter((r) => r.method === 'POST')
      .map((r) => ((r.body as FormData).get('file') as File).name)
    expect(names).toEqual(['a.txt', 'b.bin'])
  })

  it('uploads a file from a folder by its basename', async () => {
    const requests = serveExtras()
    await mkdir(join(dir, 'deep'))
    const path = join(dir, 'deep', 'x.md')
    await writeFile(path, '# x')
    await runJson(['attach', 'add', KEY, path])
    expect(
      ((requests[1]?.body as FormData | undefined)?.get('file') as File | undefined)?.name,
    ).toBe('x.md')
  })

  it('refuses a file over the site limit before any upload, with its size in the details', async () => {
    const requests = serveExtras(limit(10))
    const path = await file('big.txt', 'x'.repeat(20))
    const { code, error } = await runJson(['attach', 'add', KEY, path])
    expect(code).toBe(2)
    expect(error?.code).toBe('validation_failed')
    expect(error?.message).toContain("big.txt is 20 bytes, over this site's limit of 10")
    expect(error?.details).toEqual({ size: 20, uploadLimit: 10 })
    expect(calls(requests)).toEqual([META])
  })

  it('accepts a file exactly at the limit', async () => {
    const requests = serveExtras(limit(5))
    const path = await file('five.txt', '12345')
    expect((await runJson(['attach', 'add', KEY, path])).code).toBe(0)
    expect(calls(requests)).toEqual([META, `POST ${UPLOAD}`])
  })

  it('refuses when attachments are turned off, before any upload', async () => {
    const requests = serveExtras(limit(100, false))
    const path = await file('a.txt', 'A')
    const { code, error } = await runJson(['attach', 'add', KEY, path])
    expect(code).toBe(2)
    expect(error?.message).toBe('Attachments are turned off on this Jira site.')
    expect(calls(requests)).toEqual([META])
  })

  it('refuses the whole batch when a later file is over the limit, before any upload', async () => {
    const requests = serveExtras(limit(10))
    const small = await file('small.txt', '12345')
    const big = await file('big.txt', 'x'.repeat(20))
    const { code, error } = await runJson(['attach', 'add', KEY, small, big])
    expect(code).toBe(2)
    expect(error?.message).toMatch(/^big\.txt is 20 bytes, over this site's limit of 10\./)
    expect(calls(requests)).toEqual([META])
  })

  it('names the files already attached when a later upload fails', async () => {
    let uploads = 0
    const requests = serveExtras(({ method, path }) => {
      if (method !== 'POST' || !path.endsWith('/attachments')) return undefined
      uploads += 1
      return uploads === 1 ? undefined : Response.json({ errorMessages: ['Boom'] }, { status: 500 })
    })
    const a = await file('a.txt', 'A')
    const b = await file('b.txt', 'B')
    const { code, error } = await runJson(['attach', 'add', KEY, a, b])
    expect(code).toBe(5)
    expect(error?.code).toBe('jira_error')
    expect(error?.message).toMatch(/Already attached: 1f4a1\.png\.$/)
    expect(calls(requests)).toEqual([META, `POST ${UPLOAD}`, `POST ${UPLOAD}`])
  })

  it.each([
    ['a missing file', () => join(dir, 'nope.txt'), 'no such file'],
    ['a directory', () => dir, 'it is not a regular file'],
    ['a device', () => '/dev/null', 'it is not a regular file'],
    ['stdin', () => '-', 'Cannot attach stdin'],
  ])('refuses %s before any request', async (_name, path, reason) => {
    const requests = serveExtras()
    const { code, error } = await runJson(['attach', 'add', KEY, path()])
    expect(code).toBe(2)
    expect(error?.code).toBe('validation_failed')
    expect(error?.message).toContain(reason)
    expect(requests).toEqual([])
  })

  it('checks every file before it uploads any', async () => {
    const requests = serveExtras()
    const good = await file('good.txt', 'ok')
    const { code } = await runJson(['attach', 'add', KEY, good, join(dir, 'nope.txt')])
    expect(code).toBe(2)
    expect(requests).toEqual([])
  })

  it('needs at least one file', async () => {
    const requests = serveExtras()
    expect((await runJson(['attach', 'add', KEY])).code).toBe(2)
    expect(requests).toEqual([])
  })

  it('prints the new attachments as a table on a terminal', async () => {
    serveExtras()
    const path = await file('notes.txt', 'hello')
    const { code, lines } = await runTty(['attach', 'add', KEY, path])
    expect(code).toBe(0)
    expect(lines[0]).toMatch(/^ID +BYTES +AUTHOR +CREATED +FILENAME$/)
    expect(lines[1]).toMatch(/^652124 /)
  })

  it('exits 3 for an issue that does not exist', async () => {
    serveExtras(({ method, path }) =>
      method === 'POST' && path.endsWith('/attachments') ? issueNotFound() : undefined,
    )
    const path = await file('a.txt', 'A')
    expect((await runJson(['attach', 'add', KEY, path])).code).toBe(3)
  })
})

describe('jm attach remove', () => {
  it('deletes the attachment by id, without --confirm', async () => {
    const requests = serveExtras()
    const { code, data } = await runJson(['attach', 'remove', '652124'])
    expect(code).toBe(0)
    expectShape(data, spec('attach remove')?.output.example)
    expect(data).toEqual({ attachmentId: '652124' })
    expect(calls(requests)).toEqual(['DELETE /rest/api/3/attachment/652124'])
  })

  it('prints the result on a terminal', async () => {
    serveExtras()
    const { f } = await runTty(['attach', 'remove', '652124'])
    expect(f.stdout).toBe('Removed attachment 652124\n')
  })

  it('exits 3 for an attachment that does not exist', async () => {
    serveExtras(issueNotFound)
    expect((await runJson(['attach', 'remove', '1'])).code).toBe(3)
  })

  it('exits 2 for an id that is not digits, before any request', async () => {
    const requests = serveExtras()
    expect((await runJson(['attach', 'remove', '12/../3'])).code).toBe(2)
    expect(requests).toEqual([])
  })
})

describe('attach commands outside the project or logged out', () => {
  it('add refuses a key outside PSAPAC with no request, before reading the file', async () => {
    const requests = serveExtras()
    const path = await file('a.txt', 'A')
    const { code, error } = await runJson(['attach', 'add', 'OTHER-5', path])
    expect(code).toBe(2)
    expect(error?.message).toBe('OTHER-5 is not in PSAPAC. jm manages the PSAPAC project only.')
    expect(requests).toEqual([])
  })

  const loggedOut: [string, string[]][] = [
    ['list', ['attach', 'list', KEY]],
    ['remove', ['attach', 'remove', '1']],
  ]

  it.each(loggedOut)('%s exits 4 when logged out, before any request', async (_name, argv) => {
    const requests = serveExtras()
    const { code, error } = await runJson(argv, { keychain: fakeSecurity().keychain })
    expect(code).toBe(4)
    expect(error?.code).toBe('permission_denied')
    expect(requests).toEqual([])
  })

  it('add exits 4 when logged out, before any request', async () => {
    const requests = serveExtras()
    const path = await file('a.txt', 'A')
    const { code } = await runJson(['attach', 'add', KEY, path], {
      keychain: fakeSecurity().keychain,
    })
    expect(code).toBe(4)
    expect(requests).toEqual([])
  })
})
