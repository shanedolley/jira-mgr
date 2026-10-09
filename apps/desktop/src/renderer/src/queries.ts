import type { Issue, JiraMgrError } from '@jira-mgr/core'
import type { IssueDetail } from '@jira-mgr/core/issue'
import {
  CancelledError,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type MutationOptions,
  type QueryClient,
} from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

import type {
  CreateIssueArgs,
  EditIssueArgs,
  IssuePhase,
  IssuesProgress,
  LoginArgs,
  OptionField,
  SetSprintArgs,
  SetStatusArgs,
  SetSummaryArgs,
  SessionState,
  Toggles,
} from '../../shared/ipc'
import { call } from './ipc'
import {
  applyCreated,
  deleteMutation,
  doneKey,
  issueDetailKey,
  issueMutation,
  issuesKey,
  summaryMutation,
  unresolvedKey,
} from './optimistic'
import { editEntry, recorder, sprintEntry, statusEntry, summaryEntry, undoStack } from './undo'

export const sessionKey = ['session'] as const

/** Who is logged in. It changes only when this app logs in or out, so it never refetches by itself. */
export function useSession() {
  return useQuery({
    queryKey: sessionKey,
    queryFn: () => call('session:get'),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}

export const meKey = ['me'] as const
export const customersKey = ['customers'] as const
export const togglesKey = ['toggles'] as const

/** Done issues change only when something resolves or reopens, which the unresolved refetch sees. */
const DONE_STALE_MS = 5 * 60_000

/**
 * Numbers each load the renderer starts and keeps the running count of the latest load per phase.
 * Progress for any other load id is ignored, so a superseded load cannot set the count back.
 */
export function createLoadTracker() {
  let lastId = 0
  const current: Partial<Record<IssuePhase, { loadId: number; loaded: number }>> = {}
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of listeners) listener()
  }
  return {
    /** Starts a load of `phase` and returns its id. The count starts again from 0. */
    begin(phase: IssuePhase): number {
      lastId += 1
      current[phase] = { loadId: lastId, loaded: 0 }
      emit()
      return lastId
    },
    report({ phase, loadId, loaded }: IssuesProgress): void {
      if (current[phase]?.loadId !== loadId) return
      current[phase] = { loadId, loaded }
      emit()
    },
    loaded: (phase: IssuePhase): number => current[phase]?.loaded ?? 0,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export const loads = createLoadTracker()

type LoadPhase = (phase: IssuePhase) => Promise<Issue[]>

/** One phase from main. A `null` answer means the load was aborted. */
const loadFromMain: LoadPhase = async (phase) => {
  const issues = await call('issues:list', { phase, loadId: loads.begin(phase) })
  // Nobody reads an aborted load, so it ends the query quietly instead of failing it.
  if (issues === null) throw new CancelledError({ silent: true })
  return issues
}

/**
 * An issue that left the unresolved set was resolved, deleted or moved. It stays in the Tree with
 * its last status until Done reloads, instead of blinking out for the length of the reload.
 * Done is left alone while it holds no data: its first load reads Jira afresh.
 */
function keepDeparted(client: QueryClient, next: Issue[]): void {
  const previous = client.getQueryData<Issue[]>(unresolvedKey)
  if (previous === undefined || client.getQueryData<Issue[]>(doneKey) === undefined) return
  const present = new Set(next.map((i) => i.key))
  const departed = previous.filter((i) => !present.has(i.key))
  if (departed.length === 0) return
  const gone = new Set(departed.map((i) => i.key))
  client.setQueryData<Issue[]>(doneKey, (done) => [
    ...(done ?? []).filter((i) => !gone.has(i.key)),
    ...departed,
  ])
  void client.invalidateQueries({ queryKey: doneKey })
}

/** Unresolved issues, refetched on every focus. */
export function unresolvedQuery(client: QueryClient, load: LoadPhase = loadFromMain) {
  return queryOptions({
    queryKey: unresolvedKey,
    queryFn: async () => {
      const issues = await load('unresolved')
      keepDeparted(client, issues)
      return issues
    },
  })
}

/** Done issues, loaded once the unresolved phase has data and refetched only when stale. */
export function doneQuery(enabled: boolean, load: LoadPhase = loadFromMain) {
  return queryOptions({
    queryKey: doneKey,
    queryFn: () => load('done'),
    enabled,
    staleTime: DONE_STALE_MS,
  })
}

export function useUnresolvedIssues() {
  return useQuery(unresolvedQuery(useQueryClient()))
}

export function useDoneIssues(enabled: boolean) {
  return useQuery(doneQuery(enabled))
}

/** The issues loaded so far in the running load of `phase`. */
export function useLoadedCount(phase: IssuePhase): number {
  return useSyncExternalStore(loads.subscribe, () => loads.loaded(phase))
}

/** The signed-in user. It changes only with a login. */
export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: () => call('user:me'),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}

/** Every Customer option, which `buildHierarchy` needs only while empty Customers show. */
export function useCustomers(enabled: boolean) {
  return useQuery({
    queryKey: customersKey,
    queryFn: () => call('fields:customers'),
    enabled,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}

export function useToggles() {
  return useQuery({
    queryKey: togglesKey,
    queryFn: () => call('settings:getToggles'),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}

/**
 * Shows a toggle at once, then writes it. A failed write refetches the toggles, so the toolbar
 * shows what the settings file holds.
 */
export function togglesMutation(
  client: QueryClient,
  send: (toggles: Toggles) => Promise<Toggles>,
): MutationOptions<Toggles, JiraMgrError, Toggles> {
  return {
    mutationFn: send,
    async onMutate(toggles) {
      await client.cancelQueries({ queryKey: togglesKey })
      client.setQueryData<Toggles>(togglesKey, toggles)
    },
    async onError() {
      await client.invalidateQueries({ queryKey: togglesKey })
    },
  }
}

export function useSetToggles() {
  const client = useQueryClient()
  return useMutation(togglesMutation(client, (toggles) => call('settings:setToggles', toggles)))
}

/** Prefix of the picker queries: transitions, sprints, users and field options. */
export const pickerKey = ['picker'] as const

/** What the next account must not see: this one's issues, user, Customer list and picker choices. */
export function clearAccountData(client: QueryClient): void {
  client.removeQueries({ queryKey: issuesKey })
  client.removeQueries({ queryKey: meKey })
  client.removeQueries({ queryKey: customersKey })
  client.removeQueries({ queryKey: pickerKey })
  // An undo must not write one account's old values into the next account's issues.
  undoStack(client).clear()
}

/**
 * Logs in and stores the session. `gcTime: 0` drops the mutation, and the token in its variables,
 * as soon as the login screen unmounts, instead of keeping it in the cache for minutes.
 */
export function loginMutation(
  client: QueryClient,
  send: (args: LoginArgs) => Promise<SessionState>,
): MutationOptions<SessionState, JiraMgrError, LoginArgs> {
  return {
    mutationFn: send,
    gcTime: 0,
    onSuccess: (state) => {
      client.setQueryData(sessionKey, state)
    },
  }
}

export function useLogin() {
  const client = useQueryClient()
  return useMutation(loginMutation(client, (args) => call('session:login', args)))
}

/**
 * Logs out. The issue queries are cancelled first: main aborts their loads and answers each with
 * `null`, which ends a query silently, and TanStack reads a silent end as "a new fetch is coming".
 * If the logout then failed, those queries would stay `fetching`. Cancelled already, they do not.
 */
export function logoutMutation(
  client: QueryClient,
  send: () => Promise<SessionState>,
): MutationOptions<SessionState> {
  return {
    mutationFn: send,
    async onMutate() {
      await client.cancelQueries({ queryKey: issuesKey })
    },
    onSuccess: (state) => {
      clearAccountData(client)
      client.setQueryData(sessionKey, state)
    },
  }
}

export function useLogout() {
  const client = useQueryClient()
  return useMutation(logoutMutation(client, () => call('session:logout')))
}

const rereadIssue = (key: string): Promise<IssueDetail> => call('issues:get', { key })

/**
 * An edit that sends `changes`, shows `patch` at once and reads the issue again once it settles.
 * `undoing` marks an edit that is itself an undo, which the stack must not record again.
 */
export type EditArgs = EditIssueArgs & { patch: Partial<Issue>; undoing?: boolean }
export type StatusArgs = SetStatusArgs & { patch: Partial<Issue>; undoing?: boolean }
export type SprintArgs = SetSprintArgs & { patch: Partial<Issue>; undoing?: boolean }
export type SummaryArgs = SetSummaryArgs & { undoing?: boolean }

export function useSetSummary() {
  const client = useQueryClient()
  return useMutation(
    summaryMutation(
      client,
      ({ key, summary }: SummaryArgs) => call('issues:setSummary', { key, summary }),
      rereadIssue,
      recorder(client, summaryEntry),
    ),
  )
}

export function useEditIssue() {
  const client = useQueryClient()
  return useMutation(
    issueMutation(
      client,
      ({ key, changes }: EditArgs) => call('issues:edit', { key, changes }),
      ({ patch }) => patch,
      rereadIssue,
      recorder(client, editEntry),
    ),
  )
}

export function useSetStatus() {
  const client = useQueryClient()
  return useMutation(
    issueMutation(
      client,
      ({ key, statusId }: StatusArgs) => call('issues:setStatus', { key, statusId }),
      ({ patch }) => patch,
      rereadIssue,
      recorder(client, statusEntry),
    ),
  )
}

export function useSetSprint() {
  const client = useQueryClient()
  return useMutation(
    issueMutation(
      client,
      ({ key, sprintId }: SprintArgs) => call('issues:setSprint', { key, sprintId }),
      ({ patch }) => patch,
      rereadIssue,
      recorder(client, sprintEntry),
    ),
  )
}

/** Creates an issue and puts the read-back into the lists. Not optimistic: the key is Jira's to give. */
export function useCreateIssue() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (args: CreateIssueArgs) => call('issues:create', args),
    onSuccess: (created) => {
      applyCreated(client, created)
    },
  })
}

export function useDeleteIssue() {
  const client = useQueryClient()
  return useMutation(deleteMutation(client, (args) => call('issues:delete', args)))
}

/** One issue with its description and subtasks. It refetches on focus, like the lists. */
export function useIssueDetail(key: string | null) {
  return useQuery({
    queryKey: issueDetailKey(key ?? ''),
    queryFn: () => call('issues:get', { key: key ?? '' }),
    enabled: key !== null,
  })
}

/** The statuses the issue can move to now, read when the status picker opens. */
export function useTransitions(key: string, enabled: boolean) {
  return useQuery({
    queryKey: [...pickerKey, 'transitions', key],
    queryFn: () => call('issues:transitions', { key }),
    enabled,
    staleTime: 0,
    gcTime: 0,
  })
}

/** Active and future sprints, or every sprint. They change rarely, so a minute is fresh. */
export function useSprints(all: boolean, enabled: boolean) {
  return useQuery({
    queryKey: [...pickerKey, 'sprints', all],
    queryFn: () => call('sprints:list', { all }),
    enabled,
    staleTime: 60_000,
  })
}

/** Assignable users matching `query`, read while the assignee picker is open. */
export function useUsers(query: string, enabled: boolean) {
  return useQuery({
    queryKey: [...pickerKey, 'users', query],
    queryFn: () => call('users:search', { query }),
    enabled,
    staleTime: 30_000,
  })
}

/** Customer, Engagement, priority or issue type options from the create metadata. */
export function useFieldOptions(field: OptionField, enabled: boolean) {
  return useQuery({
    queryKey: [...pickerKey, 'options', field],
    queryFn: () => call('fields:options', { field }),
    enabled,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}
