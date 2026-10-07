import { listAttachments, type Attachment } from '@jira-mgr/core/extras'

import type { Handler } from '../../context.js'
import { localDateTime, renderTable, type Tty } from '../../output.js'
import type { SpecOf } from '../../schema.js'

/** The table `attach list` and `attach add` print: size in bytes. */
export function renderAttachments(attachments: readonly Attachment[], tty: Tty): string {
  if (attachments.length === 0) return ''
  return renderTable(
    tty,
    [
      { header: 'ID' },
      { header: 'BYTES' },
      { header: 'AUTHOR', max: 20 },
      { header: 'CREATED' },
      { header: 'FILENAME' },
    ],
    attachments.map((a) => [
      a.id,
      String(a.size),
      a.author?.displayName ?? '',
      localDateTime(a.created),
      a.filename,
    ]),
  )
}

/** `jm attach list <key>`: each attachment with its id for `attach remove`. */
export const list: Handler<SpecOf<'attach list'>, Attachment[]> = {
  async run({ key }, ctx) {
    const attachments = await listAttachments(ctx.http(), key)
    if (attachments.length === 0 && !ctx.json) ctx.io.stderr.write('No attachments.\n')
    return attachments
  },

  render: renderAttachments,
}
