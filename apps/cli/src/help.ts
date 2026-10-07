import { ERROR_CODES, ERROR_HELP, EXIT_CODES, type ErrorCode } from '@jira-mgr/core'

import pkg from '../package.json' with { type: 'json' }
import type { HandlerMap } from './context.js'
import {
  GLOBAL_OPTIONS,
  type ArgSpec,
  type CommandSpec,
  type OptionSpec,
  type ValueType,
} from './schema.js'

export const idOf = (spec: CommandSpec): string => spec.path.join(' ')

/** The specs with a handler: the only ones Commander, help and the reference know. */
export const visible = (specs: readonly CommandSpec[], handlers: HandlerMap): CommandSpec[] =>
  specs.filter((spec) => Object.hasOwn(handlers, idOf(spec)))

/** `--assignee <assignee>`, or `--confirm` for a boolean. */
export const flagOf = (option: OptionSpec): string =>
  option.type === 'boolean'
    ? `--${option.name}`
    : `--${option.name} <${option.valueName ?? option.type}>`

export const argToken = (arg: ArgSpec): string => {
  const name = arg.variadic ? `${arg.name}...` : arg.name
  return arg.optional ? `[${name}]` : `<${name}>`
}

function usageOf(spec: CommandSpec): string {
  const args = (spec.args ?? []).map(argToken)
  const options = (spec.options ?? []).map((o) => (o.required ? flagOf(o) : `[${flagOf(o)}]`))
  return ['jm', ...spec.path, ...args, ...options].join(' ')
}

export interface HelpOptionDoc {
  name: string
  flag: string
  type: ValueType
  valueName: string | null
  description: string
  required: boolean
  default: string | number | boolean | null
  repeatable: boolean
  clearable: boolean
  choices: string[] | null
  conflicts: string[]
}

export interface HelpArgDoc {
  name: string
  type: ValueType
  description: string
  required: boolean
  variadic: boolean
  choices: string[] | null
}

export interface HelpCommandDoc {
  id: string
  usage: string
  summary: string
  description: string
  args: HelpArgDoc[]
  options: HelpOptionDoc[]
  examples: { command: string; description: string }[]
  output: { summary: string; example: unknown }
  exits: { code: ErrorCode; exit: number; when: string }[]
  writes: string[]
  calls: string[]
}

export interface ExitCodeDoc {
  exit: number
  code: ErrorCode | null
  meaning: string
  fix?: string
}

export interface HelpDoc {
  name: 'jm'
  version: string
  globalOptions: HelpOptionDoc[]
  exitCodes: ExitCodeDoc[]
  commands: HelpCommandDoc[]
}

/** The exit code of a Ctrl-C. */
export const INTERRUPTED = 130

/** Every exit code `jm` returns, with the meaning and fix of each error code. */
export function exitCodeDocs(): ExitCodeDoc[] {
  return [
    { exit: 0, code: null, meaning: 'Success' },
    ...ERROR_CODES.map((code) => ({ exit: EXIT_CODES[code], code, ...ERROR_HELP[code] })),
    { exit: INTERRUPTED, code: null, meaning: 'Interrupted with Ctrl-C' },
  ]
}

const optionDoc = (o: OptionSpec): HelpOptionDoc => ({
  name: o.name,
  flag: flagOf(o),
  type: o.type,
  valueName: o.type === 'boolean' ? null : (o.valueName ?? o.type),
  description: o.description,
  required: o.required ?? false,
  default: o.default ?? null,
  repeatable: o.repeatable ?? false,
  clearable: o.clearable ?? false,
  choices: o.choices ? [...o.choices] : null,
  conflicts: [...(o.conflicts ?? [])],
})

const commandDoc = (spec: CommandSpec): HelpCommandDoc => ({
  id: idOf(spec),
  usage: usageOf(spec),
  summary: spec.summary,
  description: spec.description ?? spec.summary,
  args: (spec.args ?? []).map((a) => ({
    name: a.name,
    type: a.type,
    description: a.description,
    required: !a.optional,
    variadic: a.variadic ?? false,
    choices: a.choices ? [...a.choices] : null,
  })),
  options: (spec.options ?? []).map(optionDoc),
  examples: spec.examples.map((e) => ({ ...e })),
  output: spec.output,
  exits: (spec.exits ?? []).map((e) => ({ ...e, exit: EXIT_CODES[e.code] })),
  writes: [...spec.writes],
  calls: [...spec.calls],
})

/** The document `jm help --json` prints. */
export function helpDoc(specs: readonly CommandSpec[], handlers: HandlerMap): HelpDoc {
  return {
    name: 'jm',
    version: pkg.version,
    globalOptions: GLOBAL_OPTIONS.map(optionDoc),
    exitCodes: exitCodeDocs(),
    commands: visible(specs, handlers).map(commandDoc),
  }
}

/** The Examples, Output and Exit codes sections appended to a command's `--help`. */
export function helpExtras(spec: CommandSpec): string {
  const examples = spec.examples.flatMap((e) => [`  ${e.command}`, `      ${e.description}`])
  const example = JSON.stringify(spec.output.example, null, 2)
    .split('\n')
    .map((line) => `    ${line}`)
  const exits = exitCodeDocs().map((e) => {
    const when = (spec.exits ?? []).filter((x) => x.code === e.code).map((x) => x.when)
    return `  ${String(e.exit).padEnd(3)}  ${(e.code ?? '').padEnd(18)}  ${when.length > 0 ? when.join(' ') : e.meaning}`
  })
  return [
    '',
    'Examples:',
    ...examples,
    '',
    'Output:',
    `  ${spec.output.summary}`,
    ...example,
    '',
    'Exit codes:',
    ...exits.map((line) => line.trimEnd()),
  ].join('\n')
}
