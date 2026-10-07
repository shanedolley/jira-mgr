import { ERROR_CODES, JiraMgrError, type ErrorCode } from '@jira-mgr/core'
import { describe, expect, it } from 'vitest'

import pkg from '../package.json' with { type: 'json' }
import type { Handler } from './context.js'
import { COMMANDS, type CommandSpec } from './schema.js'
import { run } from './run.js'
import { fakeIo } from './test-io.js'

const base = {
  examples: [{ command: 'jm x', description: 'x' }],
  output: { summary: 'x', example: {} },
  writes: [],
  calls: [],
} as const

// Test-only commands, injected through `deps`.
const specs = [
  {
    ...base,
    path: ['boom'],
    summary: 'Fail or succeed as told',
    args: [{ name: 'mode', type: 'text', description: 'What to do.' }],
  },
  {
    ...base,
    path: ['multi'],
    summary: 'Exercise every Commander error',
    args: [{ name: 'name', type: 'text', description: 'A name.' }],
    options: [
      { name: 'level', type: 'integer', description: 'A level.' },
      { name: 'need', type: 'text', required: true, description: 'Required.' },
      { name: 'a', type: 'boolean', description: 'A.', conflicts: ['b'] },
      { name: 'b', type: 'boolean', description: 'B.' },
    ],
  },
  { ...base, path: ['grp', 'leaf'], summary: 'A leaf under a noun' },
] as const satisfies readonly CommandSpec[]

const boom: Handler = {
  async run(input) {
    const { mode } = input as { mode: string }
    if ((ERROR_CODES as readonly string[]).includes(mode)) {
      throw new JiraMgrError(mode as ErrorCode, `${mode} happened`)
    }
    switch (mode) {
      case 'plain':
        throw new Error('kaput')
      case 'details':
        throw new JiraMgrError('jira_error', 'Jira said no', {
          details: { status: 500, errorMessages: ['bad'] },
          cause: new Error('secret-cause'),
        })
      case 'control':
        throw new JiraMgrError('not_found', 'bad \u001b[31mred\u009b text')
      case 'wait':
        return new Promise<never>(() => undefined)
      case 'badrender':
        return Promise.resolve({ n: 1, explode: true })
      case 'bigint':
        return Promise.resolve({ n: 10n })
      case 'circular': {
        const loop: Record<string, unknown> = { n: 1 }
        loop.self = loop
        return Promise.resolve(loop)
      }
      default:
        return Promise.resolve({ n: 1 })
    }
  },
  render(data) {
    const { n, explode } = data as { n: number; explode?: boolean }
    if (explode) throw new Error('render broke')
    return `n=${String(n)}`
  },
}
const quiet: Handler = { run: () => Promise.resolve(null), render: () => '' }
const deps = { specs, handlers: { boom, multi: quiet, 'grp leaf': quiet } }

const NO_COLOR = { NO_COLOR: '1' }

describe('run', () => {
  it('each JiraMgrError code exits with its mapped code', async () => {
    const expected: Record<ErrorCode, number> = {
      validation_failed: 2,
      not_found: 3,
      permission_denied: 4,
      jira_error: 5,
      internal: 1,
    }
    for (const code of ERROR_CODES) {
      const f = fakeIo()
      expect(await run(['boom', code], f.io, deps), code).toBe(expected[code])
      expect(JSON.parse(f.stdout)).toEqual({ error: { code, message: `${code} happened` } })
    }
  })

  it('each Commander error exits 2 with validation_failed', async () => {
    const cases: Record<string, string[]> = {
      unknownOption: ['multi', 'x', '--need', 'n', '--nope'],
      unknownCommand: ['nope'],
      missingArgument: ['multi', '--need', 'n'],
      optionMissingArgument: ['multi', 'x', '--level'],
      missingMandatoryOptionValue: ['multi', 'x'],
      invalidArgument: ['multi', 'x', '--need', 'n', '--level', 'zero'],
      conflictingOption: ['multi', 'x', '--need', 'n', '--a', '--b'],
      excessArguments: ['multi', 'x', 'y', '--need', 'n'],
    }
    for (const [name, argv] of Object.entries(cases)) {
      const f = fakeIo()
      expect(await run(argv, f.io, deps), name).toBe(2)
      const { error } = JSON.parse(f.stdout) as { error: { code: string; message: string } }
      expect(error.code, name).toBe('validation_failed')
      expect(error.message, name).not.toMatch(/^error:/)
      expect(error.message, name).not.toBe('')
    }
  })

  it('an unknown option never echoes the value after =', async () => {
    const cases = [
      ['multi', 'x', '--need', 'n', '--nope=SECRET'],
      ['multi', 'x', '--need', 'n', "--nope=SE'CRET"],
    ]
    for (const argv of cases) {
      const piped = fakeIo()
      expect(await run(argv, piped.io, deps)).toBe(2)
      expect(JSON.parse(piped.stdout)).toEqual({
        error: { code: 'validation_failed', message: "unknown option '--nope=<redacted>'" },
      })
      const tty = fakeIo({ stdoutIsTTY: true, stderrIsTTY: true, env: NO_COLOR })
      expect(await run(argv, tty.io, deps)).toBe(2)
      expect(tty.stderr).toBe("jm: unknown option '--nope=<redacted>'\n")
      for (const text of [piped.stdout, tty.stdout, tty.stderr]) expect(text).not.toContain('CRET')
    }
  })

  it('a newline in an unknown option value cannot defeat the redaction', async () => {
    for (const value of ['SE\nCRET', 'SE\r\nCRET', "SE'\nCRET'"]) {
      const f = fakeIo()
      expect(await run(['multi', 'x', '--need', 'n', `--nope=${value}`], f.io, deps)).toBe(2)
      expect(JSON.parse(f.stdout)).toEqual({
        error: { code: 'validation_failed', message: "unknown option '--nope=<redacted>'" },
      })
      expect(f.stdout).not.toContain('CRET')
    }
  })

  it('too many arguments reports the count and never the operands', async () => {
    for (const operand of ['SECRET', 'SE\nCRET']) {
      const f = fakeIo()
      expect(await run(['multi', 'x', operand, '--need', 'n'], f.io, deps)).toBe(2)
      expect(JSON.parse(f.stdout)).toEqual({
        error: {
          code: 'validation_failed',
          message: "too many arguments for 'multi'. Expected 1 argument but got 2.",
        },
      })
      const tty = fakeIo({ stdoutIsTTY: true, stderrIsTTY: true, env: NO_COLOR })
      expect(await run(['multi', 'x', operand, '--need', 'n'], tty.io, deps)).toBe(2)
      expect(tty.stderr).toBe(
        "jm: too many arguments for 'multi'. Expected 1 argument but got 2.\n",
      )
    }
  })

  it('an unknown option without a value keeps its message', async () => {
    const f = fakeIo()
    expect(await run(['multi', 'x', '--need', 'n', '--nope'], f.io, deps)).toBe(2)
    expect(JSON.parse(f.stdout)).toMatchObject({ error: { message: "unknown option '--nope'" } })
  })

  it('--help and --version exit 0', async () => {
    for (const argv of [['--help'], ['multi', '--help'], ['grp', '--help']]) {
      const f = fakeIo()
      expect(await run(argv, f.io, deps), argv.join(' ')).toBe(0)
      expect(f.stdout).toContain('Usage: jm')
    }
    const f = fakeIo()
    expect(await run(['--version'], f.io, deps)).toBe(0)
    expect(f.stdout).toBe(`${pkg.version}\n`)
  })

  it('bare jm and a noun with no verb exit 2', async () => {
    for (const argv of [[], ['grp']]) {
      const f = fakeIo()
      expect(await run(argv, f.io, deps), argv.join(' ')).toBe(2)
      expect(JSON.parse(f.stdout)).toMatchObject({ error: { code: 'validation_failed' } })
    }
    const tty = fakeIo({ stdoutIsTTY: true, stderrIsTTY: true, env: NO_COLOR })
    expect(await run(['grp'], tty.io, deps)).toBe(2)
    expect(tty.stdout).toBe('')
    expect(tty.stderr).toContain('jm: Missing command. Run jm grp --help')
  })

  it('a non-JiraMgrError exits 1 as internal without a stack', async () => {
    const f = fakeIo()
    expect(await run(['boom', 'plain'], f.io, deps)).toBe(1)
    expect(JSON.parse(f.stdout)).toEqual({
      error: {
        code: 'internal',
        message: 'Unexpected error: kaput. Run with JM_DEBUG=1 for the stack.',
      },
    })
    expect(f.stdout).not.toMatch(/\bat\b.*:\d+/)
    expect(f.stderr).toBe('')
  })

  it('JM_DEBUG=1 prints the stack of an internal error to stderr', async () => {
    const f = fakeIo({ env: { JM_DEBUG: '1' } })
    expect(await run(['boom', 'plain'], f.io, deps)).toBe(1)
    expect(f.stderr).toMatch(/Error: kaput\n\s+at /)
    expect(f.stdout).not.toContain('    at ')
  })

  it('piped output is the JSON envelope', async () => {
    const f = fakeIo()
    expect(await run(['boom', 'ok'], f.io, deps)).toBe(0)
    expect(f.stdout).toBe('{"data":{"n":1}}\n')
    expect(f.stderr).toBe('')
  })

  it('--json on a TTY prints indented JSON', async () => {
    const f = fakeIo({ stdoutIsTTY: true })
    expect(await run(['boom', 'ok', '--json'], f.io, deps)).toBe(0)
    expect(f.stdout).toBe('{\n  "data": {\n    "n": 1\n  }\n}\n')
    const plain = fakeIo({ stdoutIsTTY: true })
    expect(await run(['boom', 'ok'], plain.io, deps)).toBe(0)
    expect(plain.stdout).toBe('n=1\n')
  })

  it('a TTY failure prints jm: message to stderr and nothing to stdout', async () => {
    const f = fakeIo({ stdoutIsTTY: true, stderrIsTTY: true, env: NO_COLOR })
    expect(await run(['boom', 'not_found'], f.io, deps)).toBe(3)
    expect(f.stdout).toBe('')
    expect(f.stderr).toBe('jm: not_found happened\n')
    const coloured = fakeIo({ stdoutIsTTY: true, stderrIsTTY: true })
    await run(['boom', 'not_found'], coloured.io, deps)
    expect(coloured.stderr).toBe('\u001b[31mjm:\u001b[39m not_found happened\n')
    const dirty = fakeIo({ stdoutIsTTY: true, stderrIsTTY: true, env: NO_COLOR })
    await run(['boom', 'control'], dirty.io, deps)
    expect(dirty.stderr).toBe('jm: bad [31mred text\n')
  })

  it('--json on a TTY prints the failure as indented JSON on stdout', async () => {
    const f = fakeIo({ stdoutIsTTY: true, stderrIsTTY: true })
    expect(await run(['boom', 'not_found', '--json'], f.io, deps)).toBe(3)
    expect(f.stdout).toBe(
      '{\n  "error": {\n    "code": "not_found",\n    "message": "not_found happened"\n  }\n}\n',
    )
    expect(f.stderr).toBe('')
  })

  it('a piped failure prints the error envelope to stdout', async () => {
    const f = fakeIo()
    expect(await run(['boom', 'permission_denied'], f.io, deps)).toBe(4)
    expect(f.stdout).toBe(
      '{"error":{"code":"permission_denied","message":"permission_denied happened"}}\n',
    )
    expect(f.stderr).toBe('')
  })

  it('details pass through and cause never prints', async () => {
    const f = fakeIo({ env: { JM_DEBUG: '1' } })
    expect(await run(['boom', 'details'], f.io, deps)).toBe(5)
    expect(JSON.parse(f.stdout)).toEqual({
      error: {
        code: 'jira_error',
        message: 'Jira said no',
        details: { status: 500, errorMessages: ['bad'] },
      },
    })
    expect(f.stdout + f.stderr).not.toContain('secret-cause')
  })

  it('an aborted signal exits 130', async () => {
    const controller = new AbortController()
    const f = fakeIo({ signal: controller.signal })
    const exit = run(['boom', 'wait'], f.io, deps)
    controller.abort()
    expect(await exit).toBe(130)
    expect(f.stdout).toBe('')
    const early = new AbortController()
    early.abort()
    expect(await run(['boom', 'ok'], fakeIo({ signal: early.signal }).io, deps)).toBe(130)
  })

  it('EPIPE on stdout exits 0', async () => {
    const f = fakeIo()
    const epipe = () => {
      throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
    }
    f.io.stdout.write = epipe
    expect(await run(['boom', 'ok'], f.io, deps)).toBe(0)
    expect(f.stderr).toBe('')
    const failing = fakeIo()
    failing.io.stdout.write = epipe
    expect(await run(['boom', 'jira_error'], failing.io, deps)).toBe(0)
  })

  it('a render that throws exits 1 as internal', async () => {
    const f = fakeIo({ stdoutIsTTY: true, stderrIsTTY: true, env: NO_COLOR })
    expect(await run(['boom', 'badrender'], f.io, deps)).toBe(1)
    expect(f.stdout).toBe('')
    expect(f.stderr).toBe(
      'jm: Unexpected error: render broke. Run with JM_DEBUG=1 for the stack.\n',
    )
  })

  it('data that JSON cannot hold exits 1 as internal with the envelope', async () => {
    for (const mode of ['bigint', 'circular']) {
      const f = fakeIo()
      expect(await run(['boom', mode], f.io, deps), mode).toBe(1)
      expect(JSON.parse(f.stdout), mode).toMatchObject({ error: { code: 'internal' } })
      expect(f.stderr, mode).toBe('')
    }
  })

  it('a literal --json after a bare -- is an operand, not the flag', async () => {
    const f = fakeIo({ stdoutIsTTY: true })
    expect(await run(['boom', '--', '--json'], f.io, deps)).toBe(0)
    expect(f.stdout).toBe('n=1\n')
  })
})

// The real schema with handlers that record the input they receive.
describe('run with the real schema', () => {
  const seen: Record<string, unknown>[] = []
  const capture: Handler = {
    run(input) {
      seen.push(input as Record<string, unknown>)
      return Promise.resolve({ ok: true })
    },
    render: () => '',
  }
  const real = {
    specs: COMMANDS,
    handlers: { 'issue edit': capture, 'issue get': capture, 'issue create': capture },
  }
  const input = async (argv: string[]) => {
    seen.length = 0
    const f = fakeIo()
    expect(await run(argv, f.io, real), argv.join(' ')).toBe(0)
    return seen[0]
  }

  it('none clears a clearable option to null', async () => {
    const got = await input([
      'issue',
      'edit',
      'P-1',
      '--assignee',
      'None',
      '--due',
      'none',
      '--start',
      '2026-10-07',
    ])
    expect(got).toMatchObject({ key: 'P-1', assignee: null, due: null, start: '2026-10-07' })
    expect(got?.timeRemaining).toBeUndefined()
    expect(got?.label).toEqual([])
    expect(got?.clearDescription).toBe(false)
  })

  it('an issue key argument reaches the handler in upper case', async () => {
    expect(await input(['issue', 'get', 'psapac-12'])).toEqual({ key: 'PSAPAC-12' })
  })

  it('an invalid issue key exits 2', async () => {
    seen.length = 0
    const f = fakeIo()
    expect(await run(['issue', 'get', 'nope'], f.io, real)).toBe(2)
    const { error } = JSON.parse(f.stdout) as { error: { code: string; message: string } }
    expect(error.code).toBe('validation_failed')
    expect(error.message).toContain('Give an issue key')
    expect(seen).toEqual([])
  })

  it('the create type defaults to Story and matches in any case', async () => {
    const required = ['--summary', 'S', '--customer', 'C', '--engagement', 'E']
    expect(await input(['issue', 'create', ...required])).toMatchObject({
      type: 'Story',
      label: [],
    })
    expect(
      await input([
        'issue',
        'create',
        ...required,
        '--type',
        'bug',
        '--label',
        'a',
        '--label',
        'b',
      ]),
    ).toMatchObject({
      type: 'Bug',
      label: ['a', 'b'],
    })
  })

  it('global options work before the command as well as after it', async () => {
    for (const argv of [
      ['--json', 'issue', 'get', 'P-1'],
      ['issue', 'get', 'P-1', '--json'],
    ]) {
      const f = fakeIo({ stdoutIsTTY: true })
      expect(await run(argv, f.io, real), argv.join(' ')).toBe(0)
      expect(f.stdout, argv.join(' ')).toBe('{\n  "data": {\n    "ok": true\n  }\n}\n')
    }
  })
})
