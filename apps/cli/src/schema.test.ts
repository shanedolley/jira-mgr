import { ERROR_CODES } from '@jira-mgr/core'
import { describe, expect, expectTypeOf, it } from 'vitest'

import type { Handler } from './context.js'
import { idOf } from './help.js'
import { buildProgram } from './program.js'
import { COMMANDS, GLOBAL_OPTIONS, type CommandSpec, type InputOf, type SpecOf } from './schema.js'

const specs: readonly CommandSpec[] = COMMANDS
const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

describe('the command schema', () => {
  it('every command path is unique', () => {
    const ids = specs.map(idOf)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('option and argument names are kebab-case and unique within a command, globals included', () => {
    for (const spec of specs) {
      const names = [...(spec.args ?? []), ...(spec.options ?? []), ...GLOBAL_OPTIONS].map(
        (x) => x.name,
      )
      for (const name of names) expect(name, `${idOf(spec)} ${name}`).toMatch(KEBAB)
      expect(new Set(names).size, idOf(spec)).toBe(names.length)
    }
  })

  it('enum values carry choices and only enum values do', () => {
    for (const spec of specs) {
      for (const x of [...(spec.args ?? []), ...(spec.options ?? [])]) {
        const label = `${idOf(spec)} ${x.name}`
        expect(x.type === 'enum', label).toBe(x.choices !== undefined && x.choices.length > 0)
      }
    }
  })

  it('optional arguments follow required ones and only the last is variadic', () => {
    for (const spec of specs) {
      const args = spec.args ?? []
      args.forEach((arg, i) => {
        const label = `${idOf(spec)} ${arg.name}`
        if (arg.variadic) expect(i, label).toBe(args.length - 1)
        if (!arg.optional)
          expect(
            args.slice(0, i).every((a) => !a.optional),
            label,
          ).toBe(true)
      })
    }
  })

  it('conflicts name options of the same command', () => {
    for (const spec of specs) {
      const names = (spec.options ?? []).map((o) => o.name)
      for (const option of spec.options ?? []) {
        for (const other of option.conflicts ?? []) {
          expect(names, `${idOf(spec)} --${option.name} conflicts with --${other}`).toContain(other)
          expect(other).not.toBe(option.name)
        }
      }
    }
  })

  it('every exit names a known error code', () => {
    for (const spec of specs) {
      for (const exit of spec.exits ?? []) expect(ERROR_CODES, idOf(spec)).toContain(exit.code)
    }
  })

  it('every example starts with jm and the command path and parses without error', async () => {
    const noop: Handler = { run: () => Promise.resolve(null), render: () => '' }
    const handlers = Object.fromEntries(specs.map((s) => [idOf(s), noop]))
    for (const spec of specs) {
      for (const example of spec.examples) {
        const words = [...example.command.matchAll(/"([^"]*)"|(\S+)/g)].map(
          (m) => m[1] ?? m[2] ?? '',
        )
        expect(words.slice(0, 1 + spec.path.length), example.command).toEqual(['jm', ...spec.path])
        const program = buildProgram(specs, handlers, () => undefined, {
          writeOut: () => undefined,
          writeErr: () => undefined,
        })
        await expect(
          program.parseAsync(words.slice(1), { from: 'user' }),
          example.command,
        ).resolves.toBeDefined()
      }
    }
  })

  it('every command has a summary, an output example and at least one example', () => {
    for (const spec of specs) {
      expect(spec.summary.trim(), idOf(spec)).not.toBe('')
      expect(spec.output.summary.trim(), idOf(spec)).not.toBe('')
      expect(spec.output.example, idOf(spec)).not.toBeUndefined()
      expect(spec.examples.length, idOf(spec)).toBeGreaterThan(0)
    }
  })

  it('types a handler input from its spec', () => {
    type Del = InputOf<SpecOf<'issue delete'>>
    expectTypeOf<Del['keys']>().toEqualTypeOf<string[]>()
    expectTypeOf<Del['confirm']>().toEqualTypeOf<boolean>()
    expectTypeOf<Del['withSubtasks']>().toEqualTypeOf<boolean>()
    type Create = InputOf<SpecOf<'issue create'>>
    expectTypeOf<Create['summary']>().toEqualTypeOf<string>()
    expectTypeOf<Create['type']>().toEqualTypeOf<string>()
    expectTypeOf<Create['label']>().toEqualTypeOf<string[]>()
    expectTypeOf<Create['start']>().toEqualTypeOf<string | undefined>()
    type Edit = InputOf<SpecOf<'issue edit'>>
    expectTypeOf<Edit['assignee']>().toEqualTypeOf<string | null | undefined>()
    type Worklog = InputOf<SpecOf<'worklog add'>>
    expectTypeOf<Worklog['started']>().toEqualTypeOf<Date | undefined>()
    expectTypeOf<InputOf<SpecOf<'help'>>['command']>().toEqualTypeOf<string[]>()
  })
})
