import { setTimeout as sleep } from 'node:timers/promises'

import { CommanderError } from 'commander'

import { JiraMgrError, EXIT_CODES, type ErrorCode } from '@jira-mgr/core'

import { HANDLERS } from './commands/index.js'
import { createContext, type Deps, type Handler, type HandlerMap, type Io } from './context.js'
import { idOf, INTERRUPTED } from './help.js'
import {
  dataEnvelope,
  errorEnvelope,
  paint,
  stripControl,
  toJson,
  ttyOf,
  type ErrorBody,
} from './output.js'
import { buildProgram } from './program.js'
import { COMMANDS } from './schema.js'

/** The longest `run` waits for a state-writing command to settle after Ctrl-C. */
const SETTLE_MS = 10_000

const isEpipe = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException | undefined)?.code === 'EPIPE'

/** The words that name a command, without flags, for the "missing command" hint. */
const words = (argv: readonly string[]) => argv.filter((word) => !word.startsWith('-'))

/**
 * Commander echoes what the user typed in two errors, so `--token=SECRET` or `jm auth login SECRET`
 * would print the secret. Everything after the first `=`, or after the operand count, is cut,
 * newlines in the value included.
 */
function redact(code: string, message: string): string {
  if (code === 'commander.unknownOption') {
    return message.replace(/^(unknown option '[^'=]*)=[\s\S]*$/, "$1=<redacted>'")
  }
  if (code === 'commander.excessArguments') {
    return message.replace(/^([\s\S]*? but got \d+): [\s\S]*$/, '$1.')
  }
  return message
}

function toFailure(error: unknown, argv: readonly string[]): ErrorBody {
  if (error instanceof CommanderError) {
    const message =
      error.code === 'commander.help'
        ? `Missing command. Run ${['jm', ...words(argv), '--help'].join(' ')} to list the commands.`
        : redact(error.code, error.message.replace(/^error: /, ''))
    return { code: 'validation_failed', message }
  }
  if (error instanceof JiraMgrError) {
    return { code: error.code, message: error.message, details: error.details }
  }
  const message = error instanceof Error ? error.message : String(error)
  return {
    code: 'internal',
    message: `Unexpected error: ${message}. Run with JM_DEBUG=1 for the stack.`,
  }
}

/**
 * Runs `jm` and returns the exit code. Output goes to `io`: the result to stdout, as the JSON
 * envelope when piped or given `--json`, otherwise as the handler renders it. Errors print to
 * stdout as the envelope in JSON mode and to stderr as `jm: message` otherwise.
 */
export async function run(argv: readonly string[], io: Io, deps: Deps = {}): Promise<number> {
  try {
    return await execute(argv, io, deps)
  } catch (error) {
    if (isEpipe(error)) return 0
    throw error
  }
}

async function execute(argv: readonly string[], io: Io, deps: Deps): Promise<number> {
  // Words after a bare `--` are operands, so a literal `--json` there is not the flag.
  const flagged = argv
    .slice(0, argv.includes('--') ? argv.indexOf('--') : undefined)
    .includes('--json')
  const json = flagged || !io.stdoutIsTTY
  const specs = deps.specs ?? COMMANDS
  const handlers: HandlerMap = deps.handlers ?? HANDLERS
  const ctx = createContext(io, deps, json, specs, handlers)

  let outcome: { handler: Handler; data: unknown } | undefined
  let writesState = false
  const program = buildProgram(
    specs,
    handlers,
    async (spec, input) => {
      writesState = spec.writes.includes('state')
      const handler = handlers[idOf(spec)]
      if (handler) outcome = { handler, data: await handler.run(input, ctx) }
    },
    {
      // Help for a noun with no verb is an error, so it goes to stderr, and only for a person.
      writeOut: (text) => io.stdout.write(text),
      writeErr: (text) => {
        if (!json) io.stderr.write(text)
      },
      columns: io.columns,
      color: paint(io, io.stdoutIsTTY, 'bold', 'x') !== 'x',
    },
  )

  const interrupted = new Promise<never>((_, reject) => {
    const abort = () => {
      reject(new DOMException('Interrupted', 'AbortError'))
    }
    if (io.signal.aborted) abort()
    else io.signal.addEventListener('abort', abort, { once: true })
  })
  interrupted.catch(() => undefined)

  const parsing = program.parseAsync([...argv], { from: 'user' })
  parsing.catch(() => undefined) // the race may end first; its late failure is not news
  /**
   * A command that writes state may be half done when Ctrl-C lands, such as a stopped timer whose
   * worklog is still in flight. `bin` exits right after 130, so let it settle first, which its
   * aborted request makes quick. A second Ctrl-C kills the process, and the wait is capped. What the command says about its
   * state (the timer paused, say) goes to stderr.
   */
  const interruptedExit = async () => {
    if (writesState) {
      const settled = await Promise.race([
        parsing.then(
          () => undefined,
          (error: unknown) => error,
        ),
        sleep(SETTLE_MS, undefined, { ref: false }),
      ])
      // The restore may have failed or only half worked, and the person should know before 130.
      if (settled instanceof JiraMgrError) {
        io.stderr.write(
          `${paint(io, io.stderrIsTTY, 'red', 'jm:')} ${stripControl(settled.message)}\n`,
        )
      }
    }
    return INTERRUPTED
  }

  try {
    await Promise.race([parsing, interrupted])
  } catch (error) {
    if (io.signal.aborted) return interruptedExit()
    if (isEpipe(error)) return 0
    if (
      error instanceof CommanderError &&
      (error.code === 'commander.helpDisplayed' || error.code === 'commander.version')
    ) {
      return 0
    }
    return fail(toFailure(error, argv), error, io, json, flagged)
  }
  if (io.signal.aborted) return interruptedExit()

  if (!outcome) return 0
  const { handler, data } = outcome
  let text: string
  try {
    text = json
      ? toJson(dataEnvelope(data), flagged && io.stdoutIsTTY)
      : handler.render(data, ttyOf(io))
  } catch (error) {
    // A render that throws, or data JSON cannot hold, is a bug in the handler.
    return fail(toFailure(error, argv), error, io, json, flagged)
  }
  if (text !== '') io.stdout.write(text.endsWith('\n') ? text : `${text}\n`)
  return 0
}

function fail(failure: ErrorBody, error: unknown, io: Io, json: boolean, flagged: boolean): number {
  if (json) {
    io.stdout.write(toJson(errorEnvelope(failure), flagged && io.stdoutIsTTY))
  } else {
    io.stderr.write(`${paint(io, io.stderrIsTTY, 'red', 'jm:')} ${stripControl(failure.message)}\n`)
  }
  if (failure.code === 'internal' && io.env.JM_DEBUG === '1' && error instanceof Error) {
    io.stderr.write(`${error.stack ?? error.message}\n`)
  }
  return EXIT_CODES[failure.code satisfies ErrorCode]
}
