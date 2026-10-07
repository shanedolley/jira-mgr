import type { Io } from './context.js'

type Options = Partial<
  Pick<Io, 'stdinIsTTY' | 'stdoutIsTTY' | 'stderrIsTTY' | 'columns' | 'env' | 'signal'>
> & {
  stdin?: string
  /** What the user types at each prompt, in order. A prompt past the end gets an empty answer. */
  answers?: string[]
  /** Called with the number of prompts asked so far, as each is answered. A test can abort the signal here. */
  onPrompt?: (count: number) => void
}

/** An `Io` that collects output in strings, for tests. Piped and colourless unless told otherwise. */
export function fakeIo(options: Options = {}) {
  const out: string[] = []
  const err: string[] = []
  const asked: { question: string; hidden: boolean }[] = []
  const answers = [...(options.answers ?? [])]
  const io: Io = {
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
    readStdin: () => Promise.resolve(options.stdin ?? ''),
    prompt: (question, hidden) => {
      asked.push({ question, hidden })
      options.onPrompt?.(asked.length)
      return Promise.resolve(answers.shift() ?? '')
    },
    stdinIsTTY: options.stdinIsTTY ?? false,
    stdoutIsTTY: options.stdoutIsTTY ?? false,
    stderrIsTTY: options.stderrIsTTY ?? false,
    columns: options.columns,
    env: options.env ?? {},
    signal: options.signal ?? new AbortController().signal,
  }
  return {
    io,
    get stdout() {
      return out.join('')
    },
    asked,
    get stderr() {
      return err.join('')
    },
  }
}
