import type { ErrorCode, Issue } from '@jira-mgr/core'

/** The site, project and account a login stored. The token never appears here. */
export interface Session {
  siteUrl: string
  projectKey: string
  email: string
}

/** Logged out carries whatever settings already hold, so the login form starts filled. */
export type SessionState =
  { loggedIn: true; session: Session } | { loggedIn: false; prefill: Partial<Session> }

export interface LoginArgs extends Session {
  token: string
}

export interface SetSummaryArgs {
  key: string
  summary: string
}

/**
 * Every request the renderer can make. The preload script, the main process handlers and the
 * renderer all derive their types from this one table, so a channel name or payload cannot drift.
 */
export interface IpcContract {
  'session:get': { args: undefined; result: SessionState }
  'session:login': { args: LoginArgs; result: SessionState }
  'session:logout': { args: undefined; result: SessionState }
  'issues:list': { args: undefined; result: Issue[] }
  'issues:setSummary': { args: SetSummaryArgs; result: null }
}

export type Channel = keyof IpcContract
export type ArgsOf<C extends Channel> = IpcContract[C]['args']
export type ResultOf<C extends Channel> = IpcContract[C]['result']

const CHANNEL_TABLE: Record<Channel, true> = {
  'session:get': true,
  'session:login': true,
  'session:logout': true,
  'issues:list': true,
  'issues:setSummary': true,
}

/** Every channel, for code that builds one function per channel. The table fails to compile when one is missing. */
export const CHANNELS = Object.keys(CHANNEL_TABLE) as Channel[]

/** Main to renderer: true when the window gains focus, false when it loses it. */
export const WINDOW_FOCUS_EVENT = 'window:focus'

/** The core error shape. Thrown `Error` objects lose their fields crossing IPC, so only these travel. */
export interface IpcError {
  code: ErrorCode
  message: string
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError }

/** What the preload script exposes as `window.jm`. */
export type JmApi = {
  [C in Channel]: (args: ArgsOf<C>) => Promise<IpcResult<ResultOf<C>>>
} & {
  /** Subscribes to window focus changes. Returns the unsubscribe function. */
  onWindowFocus(listener: (focused: boolean) => void): () => void
}
