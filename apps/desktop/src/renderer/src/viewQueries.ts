import type { JiraMgrError } from '@jira-mgr/core'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type MutationOptions,
  type QueryClient,
} from '@tanstack/react-query'

import type {
  CreateViewArgs,
  DeleteViewArgs,
  DuplicateViewArgs,
  MoveViewArgs,
  RenameViewArgs,
  SavedView,
  UpdateViewArgs,
} from '../../shared/ipc'
import { call } from './ipc'
import { movedView } from './views'

export const viewsKey = ['views'] as const

/** The saved views. The file is local and cheap to read, so the default refetch on focus stays. */
export function useViews() {
  return useQuery({ queryKey: viewsKey, queryFn: () => call('views:list') })
}

/** Reads the cached list after cancelling queries: a refetch landing now would overwrite an optimistic edit. */
async function cachedViews(client: QueryClient): Promise<SavedView[] | undefined> {
  await client.cancelQueries({ queryKey: viewsKey })
  return client.getQueryData<SavedView[]>(viewsKey)
}

/** Every view mutation ends by reading the file again, so the cache shows what the CLI would read. */
const settle = (client: QueryClient) => () => client.invalidateQueries({ queryKey: viewsKey })

/**
 * Adds a view once main has made it. Not optimistic: core makes the id (a slug of the name,
 * numbered when taken), so the new row waits for the answer.
 */
export function createViewMutation(
  client: QueryClient,
  send: (args: CreateViewArgs) => Promise<SavedView>,
): MutationOptions<SavedView, JiraMgrError, CreateViewArgs> {
  return {
    mutationFn: send,
    onSuccess(created) {
      client.setQueryData<SavedView[]>(viewsKey, (views) => [
        ...(views ?? []).filter((v) => v.id !== created.id),
        created,
      ])
    },
    onSettled: settle(client),
  }
}

/**
 * Shows the new name at once, then writes it. A refusal, such as a taken name, puts the old name
 * back, unless a later edit already changed that view's name again.
 */
export function renameViewMutation(
  client: QueryClient,
  send: (args: RenameViewArgs) => Promise<SavedView>,
): MutationOptions<
  SavedView,
  JiraMgrError,
  RenameViewArgs,
  { old: SavedView; shown: string } | undefined
> {
  return {
    mutationFn: send,
    async onMutate({ id, name }) {
      const old = (await cachedViews(client))?.find((v) => v.id === id)
      if (old === undefined) return undefined
      const shown = name.trim()
      client.setQueryData<SavedView[]>(viewsKey, (views) =>
        views?.map((v) => (v.id === id ? { ...v, name: shown } : v)),
      )
      return { old, shown }
    },
    onError(_error, _args, undo) {
      if (undo === undefined) return
      client.setQueryData<SavedView[]>(viewsKey, (views) =>
        views?.map((v) => (v.id === undo.old.id && v.name === undo.shown ? undo.old : v)),
      )
    },
    onSettled: settle(client),
  }
}

/** Removes the view at once, then deletes it. A failed delete puts it back where it was. */
export function deleteViewMutation(
  client: QueryClient,
  send: (args: DeleteViewArgs) => Promise<null>,
): MutationOptions<
  null,
  JiraMgrError,
  DeleteViewArgs,
  { old: SavedView; index: number } | undefined
> {
  return {
    mutationFn: send,
    async onMutate({ id }) {
      const views = await cachedViews(client)
      const index = views?.findIndex((v) => v.id === id) ?? -1
      const old = views?.[index]
      if (old === undefined) return undefined
      client.setQueryData<SavedView[]>(viewsKey, (current) => current?.filter((v) => v.id !== id))
      return { old, index }
    },
    onError(_error, _args, undo) {
      if (undo === undefined) return
      client.setQueryData<SavedView[]>(viewsKey, (views) =>
        views === undefined || views.some((v) => v.id === undo.old.id)
          ? views
          : views.toSpliced(undo.index, 0, undo.old),
      )
    },
    onSettled: settle(client),
  }
}

/** Replaces the view's filters and toggles once main has written them. Not optimistic: a refusal changes nothing. */
export function updateViewMutation(
  client: QueryClient,
  send: (args: UpdateViewArgs) => Promise<SavedView>,
): MutationOptions<SavedView, JiraMgrError, UpdateViewArgs> {
  return {
    mutationFn: send,
    onSuccess(updated) {
      client.setQueryData<SavedView[]>(viewsKey, (views) =>
        views?.map((v) => (v.id === updated.id ? updated : v)),
      )
    },
    onSettled: settle(client),
  }
}

/** The copy waits for main, which makes its name and id, then the list is read again to place it. */
export function duplicateViewMutation(
  client: QueryClient,
  send: (args: DuplicateViewArgs) => Promise<SavedView>,
): MutationOptions<SavedView, JiraMgrError, DuplicateViewArgs> {
  return { mutationFn: send, onSettled: settle(client) }
}

/** Shows the new order at once, then writes it. A refusal puts the old order back. */
export function moveViewMutation(
  client: QueryClient,
  send: (args: MoveViewArgs) => Promise<SavedView[]>,
): MutationOptions<SavedView[], JiraMgrError, MoveViewArgs, SavedView[] | undefined> {
  return {
    mutationFn: send,
    async onMutate({ id, toIndex }) {
      const before = await cachedViews(client)
      if (before === undefined) return undefined
      client.setQueryData<SavedView[]>(viewsKey, movedView(before, id, toIndex))
      return before
    },
    onError(_error, _args, before) {
      if (before !== undefined) client.setQueryData<SavedView[]>(viewsKey, before)
    },
    onSettled: settle(client),
  }
}

export function useCreateView() {
  const client = useQueryClient()
  return useMutation(createViewMutation(client, (args) => call('views:create', args)))
}

export function useRenameView() {
  const client = useQueryClient()
  return useMutation(renameViewMutation(client, (args) => call('views:rename', args)))
}

export function useDeleteView() {
  const client = useQueryClient()
  return useMutation(deleteViewMutation(client, (args) => call('views:delete', args)))
}

export function useUpdateView() {
  const client = useQueryClient()
  return useMutation(updateViewMutation(client, (args) => call('views:update', args)))
}

export function useDuplicateView() {
  const client = useQueryClient()
  return useMutation(duplicateViewMutation(client, (args) => call('views:duplicate', args)))
}

export function useMoveView() {
  const client = useQueryClient()
  return useMutation(moveViewMutation(client, (args) => call('views:move', args)))
}
