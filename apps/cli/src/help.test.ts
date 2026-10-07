import { ERROR_CODES, EXIT_CODES } from '@jira-mgr/core'
import { describe, expect, it } from 'vitest'

import type { Handler } from './context.js'
import { help } from './commands/help.js'
import { type HelpCommandDoc, type HelpDoc } from './help.js'
import { run } from './run.js'
import { COMMANDS } from './schema.js'
import { fakeIo } from './test-io.js'

const noop: Handler = { run: () => Promise.resolve(null), render: () => '' }
// Real specs, two handlers: `help` and `issue get`.
const deps = { specs: COMMANDS, handlers: { help, 'issue get': noop } }

async function helpJson(...words: string[]): Promise<{ exit: number; data: unknown }> {
  const f = fakeIo()
  const exit = await run(['help', ...words, '--json'], f.io, deps)
  return { exit, data: (JSON.parse(f.stdout) as { data: unknown }).data }
}

// Handlers for three commands with the richest options, so help --json shows every field.
const rich = {
  specs: COMMANDS,
  handlers: { help, 'issue delete': noop, 'issue create': noop, 'issue edit': noop },
}

async function richDoc(id: string): Promise<HelpCommandDoc> {
  const f = fakeIo()
  expect(await run(['help', ...id.split(' '), '--json'], f.io, rich)).toBe(0)
  return (JSON.parse(f.stdout) as { data: HelpCommandDoc }).data
}

describe('jm help', () => {
  it('help --json lists the commands with handlers', async () => {
    const { exit, data: raw } = await helpJson()
    const data = raw as HelpDoc
    expect(exit).toBe(0)
    expect(data.name).toBe('jm')
    expect(data.commands.map((c) => c.id)).toEqual(['issue get', 'help'])
    expect(data.globalOptions.map((o) => o.flag)).toEqual(['--json'])
    const get = data.commands[0]
    expect(get?.usage).toBe('jm issue get <key>')
    expect(get?.args[0]).toMatchObject({ name: 'key', type: 'issue-key', required: true })
    expect(get?.output.example).toBeDefined()
  })

  it('help with a command path prints that command only', async () => {
    const data = (await helpJson('issue', 'get')).data as HelpCommandDoc
    expect(data.id).toBe('issue get')
    expect(data).not.toHaveProperty('commands')
  })

  it('prints Commander help for a command on a terminal', async () => {
    const f = fakeIo({ stdoutIsTTY: true })
    expect(await run(['help', 'issue', 'get'], f.io, deps)).toBe(0)
    expect(f.stdout).toContain('Usage: jm issue get')
    expect(f.stdout).toContain('Examples:')
  })

  it('help for an unknown command exits 2', async () => {
    for (const words of [['nope'], ['issue', 'list'], ['auth']]) {
      const f = fakeIo()
      expect(await run(['help', ...words], f.io, deps), words.join(' ')).toBe(2)
      expect(JSON.parse(f.stdout)).toMatchObject({ error: { code: 'validation_failed' } })
    }
  })

  it('exit codes list every error code with its meaning and fix', async () => {
    const data = (await helpJson()).data as HelpDoc
    for (const code of ERROR_CODES) {
      const row = data.exitCodes.find((e) => e.code === code)
      expect(row?.exit, code).toBe(EXIT_CODES[code])
      expect(row?.meaning, code).toBeTruthy()
      expect(row?.fix, code).toBeTruthy()
    }
    expect(data.exitCodes.map((e) => e.exit)).toEqual(
      expect.arrayContaining([0, 2, 3, 4, 5, 1, 130]),
    )
  })

  it('--json before the command works', async () => {
    const f = fakeIo({ stdoutIsTTY: true })
    expect(await run(['--json', 'help'], f.io, deps)).toBe(0)
    expect(JSON.parse(f.stdout)).toMatchObject({ data: { name: 'jm' } })
  })

  it('a command object carries its usage, arguments, examples, exits, writes and calls', async () => {
    const del = await richDoc('issue delete')
    expect(del.usage).toBe('jm issue delete <key> [--confirm] [--with-subtasks]')
    expect(del.summary).toBeTruthy()
    expect(del.description).toBeTruthy()
    expect(del.args).toEqual([
      {
        name: 'key',
        type: 'issue-key',
        description: expect.stringContaining('issue key') as unknown,
        required: true,
        variadic: false,
        choices: null,
      },
    ])
    expect(del.options.map((o) => o.flag)).toEqual(['--confirm', '--with-subtasks'])
    expect(del.options[0]).toMatchObject({
      name: 'confirm',
      type: 'boolean',
      valueName: null,
      required: false,
      default: null,
      repeatable: false,
      clearable: false,
      choices: null,
      conflicts: [],
    })
    expect(del.examples.map((e) => e.command)).toEqual([
      'jm issue delete PSAPAC-12 --confirm',
      'jm issue delete PSAPAC-12 --confirm --with-subtasks',
    ])
    expect(del.output.example).toEqual({ key: 'PSAPAC-12', deletedSubtasks: ['PSAPAC-13'] })
    expect(del.exits).toEqual([
      { code: 'validation_failed', exit: 2, when: expect.stringContaining('--confirm') as unknown },
      { code: 'not_found', exit: 3, when: expect.stringContaining('does not exist') as unknown },
    ])
    expect(del.writes).toEqual(['jira'])
    expect(del.calls).toEqual([
      '@jira-mgr/core/search#getIssue',
      '@jira-mgr/core/write#deleteIssue',
    ])
  })

  it('option entries carry type, valueName, default, choices, required, repeatable, clearable and conflicts', async () => {
    const create = await richDoc('issue create')
    const byName = (name: string) => create.options.find((o) => o.name === name)
    expect(byName('type')).toMatchObject({
      flag: '--type <type>',
      type: 'enum',
      valueName: 'type',
      default: 'Story',
      choices: ['Epic', 'Story', 'Task', 'Bug', 'Subtask'],
    })
    expect(byName('summary')).toMatchObject({
      flag: '--summary <text>',
      type: 'text',
      required: true,
    })
    expect(byName('label')).toMatchObject({ repeatable: true })
    expect(byName('description')?.conflicts).toEqual(['description-file', 'adf'])
    expect(create.usage).toContain('--summary <text> ')
    expect(create.usage).toContain('[--due <date>]')

    const edit = await richDoc('issue edit')
    const field = (name: string) => edit.options.find((o) => o.name === name)
    expect(field('assignee')).toMatchObject({ clearable: true, type: 'text' })
    expect(field('label')?.conflicts).toEqual(['add-label', 'remove-label'])
    expect(field('due')).toMatchObject({ clearable: true, type: 'date' })
  })
})
