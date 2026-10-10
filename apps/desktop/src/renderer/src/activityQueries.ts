import type { JiraMgrError } from '@jira-mgr/core'
import type { AdfDoc } from '@jira-mgr/core/adf'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type MutationOptions,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'

import type { AddAttachmentArgs, CommentItem, LinksResult, WorklogItem } from '../../shared/ipc'
import { call } from './ipc'
import { applyFreshIssue, issueDetailKey } from './optimistic'
import { attachmentListKey, commentsKey, linksKey, worklogsKey } from './queries'

/** A list from the page's own read, which refetches on window focus like the rest. */
export const useComments = (key: string) =>
  useQuery({ queryKey: commentsKey(key), queryFn: () => call('comments:list', { key }) })

export const useWorklogs = (key: string) =>
  useQuery({ queryKey: worklogsKey(key), queryFn: () => call('worklogs:list', { key }) })

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
 * holds. `settled` runs after, for the reads that depend on the write.
 */
export function removeMutation<D, A>(
  client: QueryClient,
  queryKey: QueryKey,
  send: (args: A) => Promise<unknown>,
  without: (data: D, args: A) => D,
  settled?: (args: A) => void,
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
    onSettled(_data, _error, args) {
      void client.invalidateQueries({ queryKey })
      settled?.(args)
    },
  }
}

/** Reads the issue once, so the sidebar shows the estimate and Time remaining a worklog moved. */
async function readIssue(client: QueryClient, key: string): Promise<void> {
  try {
    applyFreshIssue(client, await call('issues:get', { key }))
  } catch {
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

export function useEditComment(key: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ commentId, body }: { commentId: string; body: AdfDoc }) =>
      call('comments:edit', { key, commentId, body }),
    onSuccess: (edited) => {
      upsert(client, commentsKey(key), edited)
    },
  })
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

export function useAddLink(key: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: AddLinkInput) => call('links:add', { key, ...input }),
    // The link shows on both pages, and Jira answers with no body, so both lists read again.
    onSettled: (_data, _error, { otherKey }) =>
      Promise.all([
        client.invalidateQueries({ queryKey: linksKey(key) }),
        client.invalidateQueries({ queryKey: linksKey(otherKey) }),
      ]),
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
      ({ otherKey }) => {
        void client.invalidateQueries({ queryKey: linksKey(otherKey) })
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
