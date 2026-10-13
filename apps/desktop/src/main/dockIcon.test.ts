import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { devIconPath } from './dockIcon'

describe('devIconPath', () => {
  // `src/main` and the built `out/main` sit at the same depth, so this is the path dev resolves.
  it('names a 512 px PNG', () => {
    const png = readFileSync(devIconPath(__dirname))
    expect(png.toString('latin1', 1, 4)).toBe('PNG')
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([512, 512])
  })
})
