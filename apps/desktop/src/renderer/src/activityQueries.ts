import { JiraMgrError } from '@jira-mgr/core'
import { sameAdf, type AdfDoc } from '@jira-mgr/core/adf'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type MutationOptions,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'

import type { AddAttachmentArgs, CommentItem, LinksResult, WorklogItem } from '../../shared/ipc'
import { commentDraftIds, dropOrphanedCommentDrafts } from './drafts'
import { call } from './ipc'
import { applyUnaskedRead, current, issueDetailKey, isEditing } from './optimistic'
import {
  attachmentListKey,
  commentsKey,
  linksKey,
  worklogsKey,
  type DescriptionConflict,
} from './queries'

/** The comment list read. A draft for a comment the read no longer holds is dropped, so it stops counting. */
export const commentsQuery = (key: string) => ({
  queryKey: commentsKey(key),
  queryFn: async () => {
    const drafted = commentDraftIds(key)
    const list = await call('comments:list', { key })
    dropOrphanedCommentDrafts(
      key,
      drafted,
      list.map((comment) => comment.id),
    )
    return list
  },
})

/** A list from the page's own read, which refetches on window focus like the rest. */
export const useComments = (key: string) => useQuery(commentsQuery(key))

export const worklogsQuery = (key: string) => ({
  queryKey: worklogsKey(key),
  queryFn: () => call('worklogs:list', { key }),
})

export const useWorklogs = (key: string, options: { enabled?: boolean; staleTime?: number } = {}) =>
  useQuery({ ...worklogsQuery(key), ...options })

/**
 * How the Peek reads worklogs: only once it has held still on a row (`load`), and a list the page
 * read in the last 30 s counts as fresh. The page and the Peek share one list, so without that the
 * Peek's delayed first read could start after the page deleted a worklog and bring the row back.
 */
export const peekWorklogOptions = (load: boolean) => ({ enabled: load, staleTime: 30_000 })

/** The issue's links and every link type, which the add form offers. */
export const useLinks = (key: string) =>
  useQuery({ queryKey: linksKey(key), queryFn: () => call('links:list', { key }) })

export const useAttachments = (key: string) =>
  useQuery({
    queryKey: attachmentListKey(key),
    queryFn: () => call('attachments:list', { key }),
  })

/** Puts `item` into the cached list, replacing the one with its id, or adds it at the end. */
function upsert(client: QueryClient, queryKey: QueryKey, item: { id: string }): void {
  client.setQueryData<{ id: string }[]>(queryKey, (list) => {
    if (list === undefined) return list
    return list.some((held) => held.id === item.id)
      ? list.map((held) => (held.id === item.id ? item : held))
      : [...list, item]
  })
}

interface Removal<D> {
  previous: D | undefined
}

/**
 * A delete that shows at once. `without` drops the row from the cached data, a refusal puts the
 * data back as it was, and the list reads again once the write settles, so it shows what Jira
 * holds. `settled` runs after, for the reads that depend on the write, and says whether it failed.
 */
export function removeMutation<D, A>(
  client: QueryClient,
  queryKey: QueryKey,
  send: (args: A) => Promise<unknown>,
  without: (data: D, args: A) => D,
  settled?: (args: A, failed: boolean) => void,
): MutationOptions<unknown, JiraMgrError, A, Removal<D>> {
  return {
    mutationFn: send,
    async onMutate(args) {
      await client.cancelQueries({ queryKey })
      const previous = client.getQueryData<D>(queryKey)
      if (previous !== undefined) client.setQueryData<D>(queryKey, without(previous, args))
      return { previous }
    },
    onError(_error, _args, removal) {
      if (removal?.previous !== undefined) client.setQueryData<D>(queryKey, removal.previous)
    },
    onSettled(_data, error, args) {
      void client.invalidateQueries({ queryKey })
      settled?.(args, error !== null)
    },
  }
}

/**
 * Reads the issue once, so the sidebar shows the estimate and Time remaining a worklog moved. An
 * edit of the issue made while the read was out keeps its optimistic value and reads it itself.
 */
export async function readIssue(client: QueryClient, key: string): Promise<void> {
  try {
    applyUnaskedRead(client, await call('issues:get', { key }))
  } catch {
    if (isEditing(client, key)) return
    // The worklog was written or refused either way; the page's own read shows what Jira holds.
    await client.invalidateQueries({ queryKey: issueDetailKey(key) })
  }
}

export function useAddComment(key: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: AdfDoc) => call('comments:add', { key, body }),
    onSuccess: (added) => {
      upsert(client, commentsKey(key), added)
    },
  })
}

/** What a comment edit sends, and the comment as the edit began, which Jira's must still match. */
export interface EditCommentInput {
  commentId: string
  body: AdfDoc
  base: AdfDoc
}

/**
 * Reads the comments again and refuses, as a description save does, when the comment no longer
 * matches `base` (a conflict that carries Jira's comment) or is gone. The read goes straight to
 * Jira and leaves the list alone, apart from the one comment it found changed, so the row stays
 * mounted and keeps the text being saved.
 */
export async function assertCommentUnchanged(
  client: QueryClient,
  key: string,
  { commentId, base }: Pick<EditCommentInput, 'commentId' | 'base'>,
): Promise<void> {
  const fresh = (await call('comments:list', { key })).find((comment) => comment.id === commentId)
  if (fresh === undefined) {
    throw new JiraMgrError('not_found', 'The comment was deleted in Jira, so it cannot be saved.')
  }
  if (sameAdf(fresh.body, base)) return
  upsert(client, commentsKey(key), fresh)
  throw new JiraMgrError('validation_failed', 'The comment changed in Jira while you edited.', {
    details: { conflict: true, current: fresh.body } satisfies DescriptionConflict,
  })
}

/** The options of a comment edit: it checks the comment first, and puts Jira's answer in the list. */
export const editCommentMutation = (client: QueryClient, key: string) => ({
  mutationFn: async (input: EditCommentInput) => {
    await assertCommentUnchanged(client, key, input)
    return call('comments:edit', { key, commentId: input.commentId, body: input.body })
  },
  onSuccess: (edited: CommentItem) => {
    upsert(client, commentsKey(key), edited)
  },
})

export function useEditComment(key: string) {
  const client = useQueryClient()
  return useMutation(editCommentMutation(client, key))
}

export function useDeleteComment(key: string) {
  const client = useQueryClient()
  return useMutation(
    removeMutation<CommentItem[], string>(
      client,
      commentsKey(key),
      (commentId) => call('comments:delete', { key, commentId }),
      (list, commentId) => list.filter((comment) => comment.id !== commentId),
    ),
  )
}

/** What a worklog form sends. */
export interface WorklogInput {
  timeSpent: string
  started?: string
  comment?: AdfDoc
}

export function useAddWorklog(key: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: WorklogInput) => call('worklogs:add', { key, ...input }),
    onSuccess: (added) => {
      upsert(client, worklogsKey(key), added)
    },
    onSettled: () => readIssue(client, key),
  })
}

export function useEditWorklog(key: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ worklogId, ...input }: Partial<WorklogInput> & { worklogId: string }) =>
      call('worklogs:edit', { key, worklogId, ...input }),
    onSuccess: (edited) => {
      upsert(client, worklogsKey(key), edited)
    },
    onSettled: () => readIssue(client, key),
  })
}

export function useDeleteWorklog(key: string) {
  const client = useQueryClient()
  return useMutation(
    removeMutation<WorklogItem[], string>(
      client,
      worklogsKey(key),
      (worklogId) => call('worklogs:delete', { key, worklogId }),
      (list, worklogId) => list.filter((worklog) => worklog.id !== worklogId),
      () => {
        void readIssue(client, key)
      },
    ),
  )
}

export interface AddLinkInput {
  typeId: string
  direction: 'outward' | 'inward'
  otherKey: string
}

/**
 * After a link is added or removed: the link shows on both pages, and Jira answers with no body,
 * so both link lists read again. Each end the Tree holds reads again too, so its blocker pills and
 * the Relations filter, which read the links the lists hold, follow the change.
 */
export function linkSettled(
  client: QueryClient,
  key: string,
  otherKey: string,
  failed: boolean,
): Promise<unknown> {
  // A refused write changed nothing to read. An end no cache holds, such as an issue of another
  // project, has no row to refresh, and reading it would add one to the Tree.
  const reads = failed
    ? []
    : [key, otherKey]
        .filter((end) => current(client, end) !== undefined)
        .map((end) => readIssue(client, end))
  return Promise.all([
    client.invalidateQueries({ queryKey: linksKey(key) }),
    client.invalidateQueries({ queryKey: linksKey(otherKey) }),
    ...reads,
  ])
}

export function useAddLink(key: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: AddLinkInput) => call('links:add', { key, ...input }),
    onSettled: (_data, error, { otherKey }) => linkSettled(client, key, otherKey, error !== null),
  })
}

export function useRemoveLink(key: string) {
  const client = useQueryClient()
  return useMutation(
    removeMutation<LinksResult, { linkId: string; otherKey: string }>(
      client,
      linksKey(key),
      ({ linkId }) => call('links:remove', { key, linkId }),
      (data, { linkId }) => ({ ...data, links: data.links.filter((link) => link.id !== linkId) }),
      ({ otherKey }, failed) => {
        void linkSettled(client, key, otherKey, failed)
      },
    ),
  )
}

/**
 * Attaches one file to the issue in its variables. The key travels with the file, not with the
 * hook, because a queued drop can run after the page has moved to another issue.
 */
export function useAttachFile() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ key, ...file }: AddAttachmentArgs) => call('attachments:add', { key, ...file }),
    onSuccess: (added, { key }) => {
      upsert(client, attachmentListKey(key), added)
    },
    onSettled: (_data, _error, { key }) =>
      client.invalidateQueries({ queryKey: attachmentListKey(key) }),
  })
}

export function useDownloadAttachment(key: string) {
  return useMutation({
    mutationFn: (attachmentId: string) => call('attachments:download', { key, attachmentId }),
  })
}
