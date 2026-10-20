import { EXIT_CODES, JiraMgrError, type ErrorCode } from '@jira-mgr/core'
import { assertInProject } from '@jira-mgr/core/state'
import { deleteIssues, type DeletedKeys } from '@jira-mgr/core/write'

import type { Handler } from '../../context.js'
import { stripControl } from '../../output.js'
import type { SpecOf } from '../../schema.js'

/** What several keys return: every issue deleted, and every one that failed with its error. */
interface Summary {
  deleted: DeletedKeys[]
  failed: { key: string; error: { code: ErrorCode; message: string } }[]
}

const isSummary = (data: DeletedKeys | Summary): data is Summary => 'deleted' in data

const renderDeleted = ({ key, deletedSubtasks }: DeletedKeys) =>
  deletedSubtasks.length === 0
    ? `Deleted ${stripControl(key)}`
    : `Deleted ${stripControl(key)} and its subtasks ${stripControl(deletedSubtasks.join(', '))}`

const failedLine = (key: string, message: string) =>
  `Could not delete ${stripControl(key)}: ${stripControl(message)}`

/**
 * `jm issue delete <key>...`: needs `--confirm`, and `--with-subtasks` when an issue has subtasks.
 * Several keys are deleted lowest level first, and a failed key does not stop the rest.
 */
export const del: Handler<SpecOf<'issue delete'>, DeletedKeys | Summary> = {
  async run({ keys, confirm, withSubtasks }, ctx) {
    const unique = [...new Set(keys)]
    // Checked before any request, so a forgotten flag or a foreign key costs nothing.
    for (const key of unique) await assertInProject(key)
    if (!confirm) {
      throw new JiraMgrError(
        'validation_failed',
        `Deleting ${unique.join(', ')} is permanent. Pass --confirm.`,
      )
    }
    const { deleted, failed } = await deleteIssues(
      ctx.http(),
      unique.map((key) => ({ key, deleteSubtasks: withSubtasks })),
      {
        subtaskHint: 'Pass --with-subtasks to delete them too.',
        signal: ctx.signal,
        // Several keys report each one as it settles, so a Ctrl-C part way still says what went.
        onSettled: ({ key, deleted, error }) => {
          if (unique.length === 1) return
          const line =
            deleted === null ? failedLine(key, error?.message ?? '') : renderDeleted(deleted)
          ctx.io.stderr.write(`${line}\n`)
        },
      },
    )
    // One key keeps its own output and exit code: its failure is the command's.
    const [only] = deleted
    const [refused] = failed
    if (unique.length === 1 && refused !== undefined) throw refused.error
    if (unique.length === 1 && only !== undefined) return only
    return {
      deleted,
      failed: failed.map(({ key, error }) => ({
        key,
        error: { code: error.code, message: error.message },
      })),
    }
  },

  // Each key already went to stderr as it settled, so several keys print only the count.
  render: (data) =>
    isSummary(data)
      ? `Deleted ${String(data.deleted.length)} issues${data.failed.length === 0 ? '' : `, ${String(data.failed.length)} failed`}`
      : renderDeleted(data),

  // The first failure's code stands for the run, so a script can tell not found from forbidden.
  exitCode: (data) => {
    const [first] = isSummary(data) ? data.failed : []
    return first === undefined ? 0 : EXIT_CODES[first.error.code]
  },
}
