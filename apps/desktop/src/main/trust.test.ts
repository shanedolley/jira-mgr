import { describe, expect, it } from 'vitest'

import { isTrustedFrame } from './trust'

const OWN_FILE = 'file:///Applications/jira-mgr/out/renderer/index.html'
const OWN_DEV = 'http://localhost:5173/'

describe('isTrustedFrame', () => {
  it('trusts the main frame showing our own file, ignoring a fragment or query', () => {
    const main = { url: `${OWN_FILE}#issues?x=1` }
    expect(isTrustedFrame(main, main, OWN_FILE)).toBe(true)
  })

  it('trusts the main frame on the dev server URL', () => {
    const main = { url: 'http://localhost:5173/?t=1' }
    expect(isTrustedFrame(main, main, OWN_DEV)).toBe(true)
  })

  it('refuses a request with no frame', () => {
    expect(isTrustedFrame(null, { url: OWN_FILE }, OWN_FILE)).toBe(false)
    expect(isTrustedFrame(undefined, { url: OWN_FILE }, OWN_FILE)).toBe(false)
  })

  it('refuses a subframe, even one that shows our page', () => {
    const main = { url: OWN_FILE }
    const sub = { url: OWN_FILE }
    expect(isTrustedFrame(sub, main, OWN_FILE)).toBe(false)
  })

  it('refuses the main frame once it shows another page', () => {
    const main = { url: 'https://example.com/index.html' }
    expect(isTrustedFrame(main, main, OWN_FILE)).toBe(false)
    const other = { url: 'file:///Users/someone/evil.html' }
    expect(isTrustedFrame(other, other, OWN_FILE)).toBe(false)
  })

  it('refuses a look-alike on another origin or port', () => {
    const main = { url: 'http://localhost:5174/' }
    expect(isTrustedFrame(main, main, OWN_DEV)).toBe(false)
    const lookalike = { url: 'http://localhost:5173.evil.test/' }
    expect(isTrustedFrame(lookalike, lookalike, OWN_DEV)).toBe(false)
  })

  it('refuses a frame whose URL is not a URL', () => {
    const main = { url: '' }
    expect(isTrustedFrame(main, main, OWN_FILE)).toBe(false)
  })
})
