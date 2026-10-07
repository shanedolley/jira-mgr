import type { Io } from './context.js'

type Options = Partial<Pick<Io, 'stdoutIsTTY' | 'stderrIsTTY' | 'columns' | 'env' | 'signal'>> & {
  stdin?: string
}

/** An `Io` that collects output in strings, for tests. Piped and colourless unless told otherwise. */
export function fakeIo(options: Options = {}) {
  const out: string[] = []
  const err: string[] = []
  const io: Io = {
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
    readStdin: () => Promise.resolve(options.stdin ?? ''),
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
    get stderr() {
      return err.join('')
    },
  }
}
