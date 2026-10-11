import type { Issue } from '@jira-mgr/core'
import type { IssueDetail } from '@jira-mgr/core/issue'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { Notice } from './create'
import { call } from './ipc'
import { applyCreated, issueDetailKey } from './optimistic'
import {
  bulkNotice,
  createInOrder,
  landedKey,
  subtaskArgs,
  withSubtask,
  type BulkResult,
} from './subtasks'

/**
 * Creates one Subtask per title under `parent`, one after another through `issues:create`. Each
 * one goes into the lists and into the parent's subtask list the moment Jira answers, and the
 * result is reported through `onNotice` whether or not the section is still on screen. A create
 * that fails in a way that may have reached Jira reads the parent before anything is retried, and
 * counts the Subtask as created if it is there and was not there when the run began.
 */
export function useAddSubtasks(
  parent: Issue,
  onNotice: (notice: Notice) => void,
  onProgress: (done: number) => void,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (titles: readonly string[]): Promise<BulkResult> => {
      // The parent's Subtasks as the page held them when the run began; `undefined` before its read lands.
      const before = client
        .getQueryData<IssueDetail>(issueDetailKey(parent.key))
        ?.subtasks.map((subtask) => subtask.key)
      return createInOrder(
        titles,
        (title) => {
          const args = subtaskArgs(parent, title)
          if (args === null)
            throw new Error(`${parent.key} needs its Customer and Engagement set first.`)
          return call('issues:create', args)
        },
        (_title, created, done) => {
          applyCreated(client, created)
          // A read of the parent that began before this lands keeps this copy (`useIssueDetail`).
          // With no copy of the parent yet (its read is out or failed), or no read-back to patch
          // from, the parent reads again and shows what Jira holds.
          const key = issueDetailKey(parent.key)
          if (created.issue === null || client.getQueryData<IssueDetail>(key) === undefined) {
            void client.invalidateQueries({ queryKey: key })
          } else {
            const { issue } = created
            client.setQueryData<IssueDetail>(
              key,
              (held) => held && { ...held, subtasks: withSubtask(held.subtasks, issue) },
            )
          }
          onProgress(done)
        },
        async (title, made) => {
          if (before === undefined)
            throw new Error(`${parent.key} has no Subtasks list to compare.`)
          const { subtasks } = await call('issues:get', { key: parent.key })
          return landedKey(subtasks, title, new Set([...before, ...made]))
        },
      )
    },
    onSuccess: (result) => {
      onNotice(bulkNotice(parent.key, result))
    },
  })
}
