import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import pkg from '../package.json' with { type: 'json' }
import { run } from './run.js'
import { fakeIo } from './test-io.js'

// The bundle comes from `tsup`, which the package's `test` script runs first.
const bundle = fileURLToPath(new URL('../dist/index.js', import.meta.url))
const jmScript = fileURLToPath(new URL('../../../scripts/jm.ts', import.meta.url))

const spawn = (file: string, args: string[]) =>
  spawnSync(process.execPath, [file, ...args], { encoding: 'utf8' })

describe('the built binary', () => {
  it("pnpm's -- is dropped before the CLI sees it", () => {
    const result = spawn(jmScript, ['--', '--version'])
    expect(result.stdout).toBe(`${pkg.version}\n`)
    expect(result.status).toBe(0)
  })

  it("the bundle's help --json equals the in-process document", async () => {
    const f = fakeIo()
    expect(await run(['help', '--json'], f.io)).toBe(0)
    const result = spawn(bundle, ['help', '--json'])
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(JSON.parse(f.stdout))
  })

  it('an unknown command exits 2 with the error envelope', () => {
    const result = spawn(bundle, ['nope'])
    expect(result.status).toBe(2)
    expect(JSON.parse(result.stdout)).toMatchObject({ error: { code: 'validation_failed' } })
  })
})
