import { JiraMgrError } from '@jira-mgr/core'
import { describe, expect, it } from 'vitest'

import { unwrap } from './ipc'

describe('unwrap', () => {
  it('returns the data of an ok result', () => {
    expect(unwrap({ ok: true, data: [1, 2] })).toEqual([1, 2])
  })

  it('throws a JiraMgrError that keeps the code and message of a failed result', () => {
    const run = () => unwrap({ ok: false, error: { code: 'not_found', message: 'No PSAPAC-9.' } })
    expect(run).toThrow(JiraMgrError)
    expect(run).toThrow(expect.objectContaining({ code: 'not_found', message: 'No PSAPAC-9.' }))
  })
})
