import { getCredentials, type Keychain } from '@jira-mgr/core/auth'
import { createHttpClient, type HttpClient } from '@jira-mgr/core/http'
import { getCurrentUser, type CurrentUser } from '@jira-mgr/core/lookups'

import type { Tty } from './output.js'
import { ask } from './prompt.js'
import type { CommandSpec, InputOf } from './schema.js'

/** Everything the CLI reads from or writes to the process, so tests can swap it. */
export interface Io {
  stdout: { write(text: string): unknown }
  stderr: { write(text: string): unknown }
  /** Reads all of stdin. */
  readStdin(): Promise<string>
  /** Asks one question on stderr and reads one line from the terminal. `hidden` never echoes the answer. */
  prompt(question: string, hidden: boolean): Promise<string>
  stdinIsTTY: boolean
  stdoutIsTTY: boolean
  stderrIsTTY: boolean
  /** The terminal width, when known. */
  columns?: number
  env: Readonly<Record<string, string | undefined>>
  /** Aborted on Ctrl-C. */
  signal: AbortSignal
}

/** The real process: the first Ctrl-C aborts the signal, the second kills the process. */
export function nodeIo(): Io {
  const controller = new AbortController()
  process.once('SIGINT', () => {
    controller.abort()
  })
  // `jm ... | head` closes the pipe early; that is a success.
  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(0)
    throw error
  })
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    readStdin: async () => {
      const chunks: Buffer[] = []
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
      return Buffer.concat(chunks).toString('utf8')
    },
    prompt: (question, hidden) =>
      ask(process.stdin, process.stderr, question, hidden, () => {
        controller.abort()
      }),
    stdinIsTTY: process.stdin.isTTY,
    stdoutIsTTY: process.stdout.isTTY,
    stderrIsTTY: process.stderr.isTTY,
    columns: process.stdout.columns,
    env: process.env,
    signal: controller.signal,
  }
}

/** A command's two halves: `run` returns the data, `render` turns it into the terminal form. */
export interface Handler<S extends CommandSpec = CommandSpec, T = unknown> {
  /** `T` becomes `data` in the envelope. */
  run(input: InputOf<S>, ctx: Context): Promise<T> | T
  /** The TTY form. An empty string prints nothing. */
  render(data: T, tty: Tty): string
}

/** Handlers by command id. A spec with no entry stays hidden. */
export type HandlerMap = Readonly<Record<string, Handler>>

/** What `run` accepts beyond argv and io. Production passes none. */
export interface Deps {
  http?: HttpClient
  keychain?: Keychain
  now?: () => Date
  specs?: readonly CommandSpec[]
  handlers?: HandlerMap
}

export interface Context {
  /** Created on first use, so help and auth commands skip the Keychain. */
  http(): HttpClient
  /** The account the stored token authenticates as. Asked once per run, on first use. */
  me(): Promise<CurrentUser>
  io: Io
  now(): Date
  /** Pass to every core call that takes one. */
  signal: AbortSignal
  /** Tests inject a fake; auth commands use it. */
  keychain?: Keychain
  /** True when the result prints as the JSON envelope. */
  json: boolean
  /** The specs and handlers this run knows, which `help` reads. */
  specs: readonly CommandSpec[]
  handlers: HandlerMap
}

export function createContext(
  io: Io,
  deps: Deps,
  json: boolean,
  specs: readonly CommandSpec[],
  handlers: HandlerMap,
): Context {
  let http = deps.http
  let me: Promise<CurrentUser> | undefined
  const ctx: Context = {
    http: () =>
      (http ??= createHttpClient({
        credentials: () => getCredentials({ keychain: deps.keychain }),
      })),
    me: () => (me ??= getCurrentUser(ctx.http(), { signal: io.signal })),
    io,
    now: deps.now ?? (() => new Date()),
    signal: io.signal,
    keychain: deps.keychain,
    json,
    specs,
    handlers,
  }
  return ctx
}
