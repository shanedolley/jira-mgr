import { describe, expect, it } from 'vitest'

import { expectShape } from './test-shape.js'

describe('expectShape', () => {
  it('accepts the same keys at every depth, comparing the first array element', () => {
    expect(() => {
      expectShape(
        { a: 1, b: { c: 'x' }, d: [{ e: 1 }, { e: 2 }] },
        { a: 9, b: { c: 'y' }, d: [{ e: 0 }] },
      )
    }).not.toThrow()
  })

  it('refuses a missing, extra or nested key difference', () => {
    expect(() => {
      expectShape({ a: 1 }, { a: 1, b: 2 })
    }).toThrow()
    expect(() => {
      expectShape({ a: 1, b: 2 }, { a: 1 })
    }).toThrow()
    expect(() => {
      expectShape({ a: { c: 1 } }, { a: { d: 1 } })
    }).toThrow()
    expect(() => {
      expectShape({ a: [{ c: 1 }] }, { a: [{ d: 1 }] })
    }).toThrow()
  })

  it('refuses a different kind of value', () => {
    expect(() => {
      expectShape({ a: 'x' }, { a: 1 })
    }).toThrow()
    expect(() => {
      expectShape({ a: {} }, { a: [] })
    }).toThrow()
  })

  it('lets a null on either side match anything and an empty array match any array', () => {
    expect(() => {
      expectShape({ a: null, b: 'x' }, { a: 'y', b: null })
    }).not.toThrow()
    expect(() => {
      expectShape({ a: [{ z: 1 }] }, { a: [] })
    }).not.toThrow()
  })
})
