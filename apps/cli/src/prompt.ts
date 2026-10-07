import { createInterface } from 'node:readline'
import { Writable, type Readable } from 'node:stream'

/**
 * Writes `question` to `output` and reads one line from `input`. A `hidden` answer is never
 * echoed. Ctrl-C calls `onInterrupt`, and Ctrl-D or a closed input gives an empty answer.
 */
export function ask(
  input: Readable,
  output: Writable,
  question: string,
  hidden: boolean,
  onInterrupt: () => void,
): Promise<string> {
  return new Promise((resolve) => {
    output.write(question)
    // readline echoes what is typed to its output, so a hidden prompt gives it a sink.
    const echo = hidden
      ? new Writable({
          write: (_chunk, _encoding, done) => {
            done()
          },
        })
      : output
    const rl = createInterface({ input, output: echo, terminal: true })
    let answer = ''
    let interrupted = false
    rl.once('line', (line) => {
      answer = line
      rl.close()
    })
    rl.once('SIGINT', () => {
      interrupted = true
      onInterrupt()
      rl.close()
    })
    rl.once('close', () => {
      // The Enter that ends a hidden answer was not echoed, and Ctrl-C ends the line too.
      if (hidden || interrupted) output.write('\n')
      resolve(answer)
    })
  })
}
