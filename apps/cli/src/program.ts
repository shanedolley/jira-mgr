import { appTitle } from '@jira-mgr/core'
import { Argument, Command, Option } from 'commander'

import pkg from '../package.json' with { type: 'json' }
import type { HandlerMap } from './context.js'
import { argToken, flagOf, helpExtras, visible } from './help.js'
import { GLOBAL_OPTIONS, NOUNS, type CommandSpec, type OptionSpec } from './schema.js'
import { parserFor } from './values.js'

/** Where Commander writes help, and how it formats it. */
export interface ProgramOut {
  writeOut(text: string): void
  writeErr(text: string): void
  columns?: number
  color?: boolean
}

type OnAction = (spec: CommandSpec, input: Record<string, unknown>) => unknown

const camel = (name: string) => name.replaceAll(/-(\w)/g, (_, c: string) => c.toUpperCase())

/** The handler input for a parsed command, keyed by each flag and argument's camelCase name. */
function inputOf(spec: CommandSpec, command: Command): Record<string, unknown> {
  const input: Record<string, unknown> = {}
  const values = command.opts<Record<string, unknown>>()
  ;(spec.args ?? []).forEach((arg, i) => {
    const value: unknown = command.processedArgs[i]
    input[camel(arg.name)] = arg.variadic ? (value ?? []) : value
  })
  for (const option of spec.options ?? []) {
    const value = values[camel(option.name)]
    // Commander turns a parser's null into '', and no clearable parser returns '' itself.
    const cleared = option.clearable === true && value === '' ? null : value
    input[camel(option.name)] =
      option.type === 'boolean' ? value === true : option.repeatable ? (value ?? []) : cleared
  }
  return input
}

function optionOf(o: OptionSpec): Option {
  const option = new Option(flagOf(o), o.description)
  // `choices` lists the values in help; the parser matches them in any case.
  if (o.choices) option.choices(o.choices)
  if (o.type !== 'boolean') option.argParser(parserFor(o))
  if (o.required) option.makeOptionMandatory()
  if (o.default !== undefined) option.default(o.default)
  if (o.conflicts) option.conflicts([...o.conflicts])
  return option
}

const globals: readonly OptionSpec[] = GLOBAL_OPTIONS

/** Builds Commander's tree from the specs that have a handler. */
export function buildProgram(
  specs: readonly CommandSpec[],
  handlers: HandlerMap,
  onAction: OnAction,
  out: ProgramOut,
): Command {
  const program = new Command('jm')
    .description(appTitle(pkg.version))
    .version(pkg.version)
    .helpCommand(false)
    .exitOverride()
    // `run` prints errors, so Commander's own error text stays quiet. Help still prints.
    .configureOutput({
      writeOut: (text) => {
        out.writeOut(text)
      },
      writeErr: (text) => {
        out.writeErr(text)
      },
      outputError: () => undefined,
      getOutHelpWidth: () => out.columns ?? 100,
      getErrHelpWidth: () => out.columns ?? 100,
      getOutHasColors: () => out.color ?? false,
      getErrHasColors: () => out.color ?? false,
    })

  // Also on the root, so `jm --json issue list` works as well as `jm issue list --json`.
  for (const o of globals) program.addOption(optionOf(o))

  const nouns = new Map<string, Command>()
  for (const spec of visible(specs, handlers)) {
    let parent = program
    for (const [i, segment] of spec.path.slice(0, -1).entries()) {
      const key = spec.path.slice(0, i + 1).join(' ')
      let noun = nouns.get(key)
      if (!noun) {
        noun = parent
          .command(segment)
          .description(NOUNS[segment] ?? segment)
          .helpCommand(false)
        nouns.set(key, noun)
      }
      parent = noun
    }

    const leaf = parent
      .command(spec.path[spec.path.length - 1] ?? '')
      .summary(spec.summary)
      .description(spec.description ?? spec.summary)
    for (const arg of spec.args ?? []) {
      const argument = new Argument(argToken(arg), arg.description)
      if (arg.choices) argument.choices(arg.choices)
      leaf.addArgument(argument.argParser(parserFor(arg)))
    }
    for (const o of [...(spec.options ?? []), ...globals]) leaf.addOption(optionOf(o))
    leaf.addHelpText('after', helpExtras(spec))
    leaf.action(async () => {
      await onAction(spec, inputOf(spec, leaf))
    })
  }
  return program
}

/** Commander's help text for the command at `path`, or for the whole tool when `path` is empty. */
export function helpText(
  specs: readonly CommandSpec[],
  handlers: HandlerMap,
  path: readonly string[],
  out: Omit<ProgramOut, 'writeOut' | 'writeErr'>,
): string | undefined {
  let text = ''
  const write = (chunk: string) => {
    text += chunk
  }
  let command: Command | undefined = buildProgram(specs, handlers, () => undefined, {
    ...out,
    writeOut: write,
    writeErr: write,
  })
  for (const segment of path) command = command?.commands.find((c) => c.name() === segment)
  if (!command) return undefined
  command.outputHelp()
  return text
}
