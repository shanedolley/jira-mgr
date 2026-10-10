import { JiraMgrError } from '@jira-mgr/core'
import { describe, expect, it } from 'vitest'

import { detailOf, unwrap } from './ipc'

describe('unwrap', () => {
  it('returns the data of an ok result', () => {
    expect(unwrap({ ok: true, data: [1, 2] })).toEqual([1, 2])
  })

  it('throws a JiraMgrError that keeps the code and message of a failed result', () => {
    const run = () => unwrap({ ok: false, error: { code: 'not_found', message: 'No PSAPAC-9.' } })
    expect(run).toThrow(JiraMgrError)
    expect(run).toThrow(expect.objectContaining({ code: 'not_found', message: 'No PSAPAC-9.' }))
  })

  it('carries the full message as detail, which detailOf reads back', () => {
    const error = {
      code: 'jira_error',
      message: 'Jira answered 500.',
      detail: 'Jira answered 500 to GET a.',
    } as const
    let caught: unknown
    try {
      unwrap({ ok: false, error })
    } catch (cause) {
      caught = cause
    }
    expect(detailOf(caught)).toBe('Jira answered 500 to GET a.')
    expect(detailOf(new JiraMgrError('jira_error', 'No detail.'))).toBeUndefined()
    expect(detailOf(new Error('Plain.'))).toBeUndefined()
  })
})
