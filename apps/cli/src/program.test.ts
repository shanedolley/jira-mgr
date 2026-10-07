import { ERROR_CODES } from '@jira-mgr/core'
import type { Command } from 'commander'
import { describe, expect, it } from 'vitest'

import type { Handler, HandlerMap } from './context.js'
import { flagOf, idOf } from './help.js'
import { buildProgram } from './program.js'
import { COMMANDS, GLOBAL_OPTIONS, NOUNS, type CommandSpec } from './schema.js'

const specs: readonly CommandSpec[] = COMMANDS
const noop: Handler = { run: () => Promise.resolve(null), render: () => '' }
const handlersFor = (ids: readonly string[]): HandlerMap =>
  Object.fromEntries(ids.map((id) => [id, noop]))
const everything = handlersFor(specs.map(idOf))

function build(handlers: HandlerMap) {
  let text = ''
  const write = (chunk: string) => {
    text += chunk
  }
  // A wide terminal keeps Commander from wrapping the text the tests look for.
  const program = buildProgram(specs, handlers, () => undefined, {
    writeOut: write,
    writeErr: write,
    columns: 10_000,
  })
  return { program, output: () => text }
}

const leaves = (command: Command): Command[] =>
  command.commands.flatMap((child) => (child.commands.length > 0 ? leaves(child) : [child]))

const pathOf = (command: Command): string => {
  const names: string[] = []
  for (let c = command; c.parent; c = c.parent) names.unshift(c.name())
  return names.join(' ')
}

async function helpFor(handlers: HandlerMap, words: string[]): Promise<string> {
  const { program, output } = build(handlers)
  await expect(program.parseAsync([...words, '--help'], { from: 'user' })).rejects.toMatchObject({
    code: 'commander.helpDisplayed',
  })
  return output()
}

describe('buildProgram', () => {
  it('the Commander tree holds exactly the commands with handlers', () => {
    const some = ['issue get', 'issue list', 'status set', 'help']
    const { program } = build(handlersFor(some))
    expect(leaves(program).map(pathOf).sort()).toEqual([...some].sort())
    expect(program.commands.map((c) => c.name()).sort()).toEqual(['help', 'issue', 'status'])
    expect(leaves(build(everything).program)).toHaveLength(specs.length)
  })

  it("each leaf's flags equal its spec's options plus the global options", () => {
    const { program } = build(everything)
    for (const leaf of leaves(program)) {
      const spec = specs.find((s) => idOf(s) === pathOf(leaf))
      const expected = [...(spec?.options ?? []), ...GLOBAL_OPTIONS].map((o) => `--${o.name}`)
      expect(
        leaf.options.map((o) => o.long),
        pathOf(leaf),
      ).toEqual(expected)
    }
  })

  it('--help prints the summary, every flag, every example and the exit codes', async () => {
    for (const spec of specs) {
      const text = await helpFor(everything, [...spec.path])
      const label = idOf(spec)
      expect(text, label).toContain(spec.description ?? spec.summary)
      for (const option of [...(spec.options ?? []), ...GLOBAL_OPTIONS]) {
        expect(text, `${label} ${option.name}`).toContain(flagOf(option))
      }
      for (const example of spec.examples) {
        expect(text, label).toContain(example.command)
        expect(text, label).toContain(example.description)
      }
      expect(text, label).toContain('Exit codes:')
      for (const code of ERROR_CODES) expect(text, `${label} ${code}`).toContain(code)
      for (const exit of spec.exits ?? []) expect(text, label).toContain(exit.when)
    }
    const noun = await helpFor(everything, ['issue'])
    for (const spec of specs.filter((s) => s.path[0] === 'issue'))
      expect(noun).toContain(spec.summary)
    expect(noun).toContain(NOUNS.issue)
  })

  it('a spec without a handler is absent from help', async () => {
    const handlers = handlersFor(['issue get'])
    const root = await helpFor(handlers, [])
    expect(root).toContain('issue')
    expect(root).not.toMatch(/^ {2}(auth|timer|status|comment)\b/m)
    const noun = await helpFor(handlers, ['issue'])
    expect(noun).toMatch(/^ {2}get\b/m)
    expect(noun).not.toMatch(/^ {2}(list|create|edit|delete|help)\b/m)
  })
})
