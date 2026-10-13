import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { devIconPath, setDevDockIcon } from './dockIcon'

describe('devIconPath', () => {
  // `src/main` and the built `out/main` sit at the same depth, so this is the path dev resolves.
  it('names a 512 px PNG', () => {
    const png = readFileSync(devIconPath(__dirname))
    expect(png.toString('latin1', 1, 4)).toBe('PNG')
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([512, 512])
  })
})

describe('setDevDockIcon', () => {
  it('sets the icon when the PNG exists', () => {
    const setIcon = vi.fn()
    setDevDockIcon(__dirname, { setIcon })
    expect(setIcon).toHaveBeenCalledWith(devIconPath(__dirname))
  })

  it('does nothing when the PNG is missing, as in the packaged app', () => {
    const setIcon = vi.fn()
    setDevDockIcon('/nonexistent/Resources/app/out/main', { setIcon })
    expect(setIcon).not.toHaveBeenCalled()
  })

  it('does nothing without a Dock', () => {
    expect(() => {
      setDevDockIcon(__dirname, undefined)
    }).not.toThrow()
  })
})
