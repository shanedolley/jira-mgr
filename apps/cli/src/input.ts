import { constants } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'

import { JiraMgrError } from '@jira-mgr/core'
import { adfDocSchema, markdownToAdf, type AdfDoc } from '@jira-mgr/core/adf'

import type { Context } from './context.js'

/** A description or comment is far smaller; the cap stops a stray `/dev/zero` or a huge file filling memory. */
const MAX_BYTES = 1024 * 1024

const refuse = (message: string) => new JiraMgrError('validation_failed', message)

/** Reads from the start of the file until it ends or `limit` bytes are in, however the reads split. */
export async function readUpTo(handle: Pick<FileHandle, 'read'>, limit: number): Promise<Buffer> {
  const buffer = Buffer.alloc(limit)
  let total = 0
  while (total < limit) {
    const { bytesRead } = await handle.read(buffer, total, limit - total, total)
    if (bytesRead === 0) break
    total += bytesRead
  }
  return buffer.subarray(0, total)
}

/**
 * Reads a file, or stdin for `-`. Refuses anything but a regular file of at most 1 MiB. The file
 * is opened once and checked through that handle, so it cannot change between the check and the
 * read, and the read stops one byte past the limit. `O_NONBLOCK` keeps a FIFO from blocking the open.
 */
export async function readSource(ctx: Context, source: string): Promise<string> {
  if (source === '-') {
    const text = await ctx.io.readStdin(MAX_BYTES)
    if (Buffer.byteLength(text) > MAX_BYTES) throw refuse('Stdin is larger than 1 MiB.')
    return text
  }
  let handle
  try {
    handle = await open(source, constants.O_RDONLY | constants.O_NONBLOCK)
    if (!(await handle.stat()).isFile()) {
      throw refuse(`Cannot read ${source}: it is not a regular file.`)
    }
    const bytes = await readUpTo(handle, MAX_BYTES + 1)
    if (bytes.length > MAX_BYTES) throw refuse(`Cannot read ${source}: it is larger than 1 MiB.`)
    return bytes.toString('utf8')
  } catch (error) {
    if (error instanceof JiraMgrError) throw error
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown error'
    throw refuse(`Cannot read ${source}: ${code === 'ENOENT' ? 'no such file' : code}.`)
  } finally {
    await handle?.close()
  }
}

/** The three description inputs a command takes. Commander has refused any two together. */
export interface TextInput {
  markdown: string | undefined
  file: string | undefined
  adf: string | undefined
}

/**
 * The ADF for Markdown text, a Markdown file or an ADF file, or `undefined` when none is given.
 * Raw ADF is validated with core's schema before anything is sent.
 */
export async function readRichText(ctx: Context, input: TextInput): Promise<AdfDoc | undefined> {
  if (input.markdown !== undefined) return markdownToAdf(input.markdown)
  if (input.file !== undefined) return markdownToAdf(await readSource(ctx, input.file))
  if (input.adf === undefined) return undefined
  const text = await readSource(ctx, input.adf)
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw refuse('The --adf input is not valid JSON.')
  }
  const parsed = adfDocSchema.safeParse(json)
  if (!parsed.success) {
    throw new JiraMgrError(
      'validation_failed',
      'The --adf input is not an ADF document (version 1, type doc).',
      { details: { issues: parsed.error.issues } },
    )
  }
  return parsed.data
}
