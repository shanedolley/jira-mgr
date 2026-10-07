import { JiraMgrError } from '@jira-mgr/core'

import type { Handler } from '../context.js'
import { helpDoc, type HelpCommandDoc, type HelpDoc } from '../help.js'
import { helpText } from '../program.js'
import type { SpecOf } from '../schema.js'

type HelpResult = HelpDoc | HelpCommandDoc | { text: string }

/** `jm help [command...]`: Commander's text on a terminal, the help document as JSON. */
export const help: Handler<SpecOf<'help'>, HelpResult> = {
  run({ command }, ctx) {
    const doc = helpDoc(ctx.specs, ctx.handlers)
    const id = command.join(' ')
    const exact = doc.commands.find((c) => c.id === id)
    const inNoun = doc.commands.filter((c) => c.id.startsWith(`${id} `))
    if (command.length > 0 && !exact && inNoun.length === 0) {
      throw new JiraMgrError(
        'validation_failed',
        `Unknown command "${id}". Run jm help to list the commands.`,
      )
    }
    if (!ctx.json) {
      const text = helpText(ctx.specs, ctx.handlers, command, {
        columns: ctx.io.columns,
        color: false,
      })
      return { text: text ?? '' }
    }
    return exact ?? (command.length === 0 ? doc : { ...doc, commands: inNoun })
  },
  render: (data) => ('text' in data ? data.text : ''),
}
