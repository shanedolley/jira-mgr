import { openAsBlob } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'

import { JiraMgrError } from '@jira-mgr/core'
import { addAttachments, type Attachment } from '@jira-mgr/core/extras'

import type { Handler } from '../../context.js'
import type { SpecOf } from '../../schema.js'
import { assertInProject } from '../../site.js'
import { renderAttachments } from './list.js'

const refuse = (message: string) => new JiraMgrError('validation_failed', message)

/**
 * A file-backed Blob for a regular file, which reads from disk only as it uploads, so core can
 * refuse one over the site's upload limit before the file is read into memory.
 */
// ponytail: stat then open leaves a gap where the path could become a FIFO; the file is the caller's own.
async function fileBlob(path: string): Promise<Blob> {
  if (path === '-') throw refuse('Cannot attach stdin: give a file path.')
  try {
    if (!(await stat(path)).isFile()) throw refuse(`Cannot read ${path}: it is not a regular file.`)
    return await openAsBlob(path)
  } catch (error) {
    if (error instanceof JiraMgrError) throw error
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown error'
    throw refuse(`Cannot read ${path}: ${code === 'ENOENT' ? 'no such file' : code}.`)
  }
}

/**
 * `jm attach add <key> <file...>`: checks every path before it uploads any. Core then reads the
 * site's upload limit once, refuses the batch if any file is over it, and uploads in order. A
 * failure after the first upload names the files already attached.
 */
export const add: Handler<SpecOf<'attach add'>, Attachment[]> = {
  async run({ key, file: paths }, ctx) {
    await assertInProject(key)
    const files = await Promise.all(
      paths.map(async (path) => ({ filename: basename(path), content: await fileBlob(path) })),
    )
    return addAttachments(ctx.http(), key, files)
  },

  render: renderAttachments,
}
