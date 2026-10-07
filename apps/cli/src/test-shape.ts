import { expect } from 'vitest'

const kind = (value: unknown) => (Array.isArray(value) ? 'array' : typeof value)

/**
 * Checks that `actual` has the keys of `example`, recursively, comparing the first element of an
 * array. A `null` on either side matches anything, because an example cannot show both forms of
 * a nullable value. Handler tests pass the command's `output.example`, so the schema's example
 * cannot drift from what the handler returns.
 */
export function expectShape(actual: unknown, example: unknown, path = 'data'): void {
  if (actual === null || example === null) return
  expect(kind(actual), `${path} is a ${kind(example)}`).toBe(kind(example))
  if (Array.isArray(example)) {
    const [first] = example as unknown[]
    const [firstActual] = actual as unknown[]
    if (first !== undefined && firstActual !== undefined)
      expectShape(firstActual, first, `${path}[0]`)
    return
  }
  if (typeof example !== 'object') return
  expect(Object.keys(actual as object).sort(), `${path} keys`).toEqual(Object.keys(example).sort())
  for (const [key, value] of Object.entries(example)) {
    expectShape((actual as Record<string, unknown>)[key], value, `${path}.${key}`)
  }
}
