import { describe, expect, it } from 'vitest'

import type { Notice } from './create'
import { MAX_TOASTS, pushToast, spoken, type ToastItem } from './toasts'

const toast = (id: number, warned = false): ToastItem => ({
  id,
  notice: { title: `Notice ${String(id)}`, notes: [], warned },
  openKey: null,
})

const ids = (items: readonly ToastItem[]) => items.map((item) => item.id)

describe('pushToast', () => {
  it(`keeps the last ${String(MAX_TOASTS)}, newest last`, () => {
    let held: ToastItem[] = []
    for (const id of [1, 2, 3]) held = pushToast(held, toast(id))
    expect(ids(held)).toEqual([2, 3])
  })

  it('drops a plain notice before a refusal, which stays until dismissed', () => {
    const refusal = toast(1, true)
    let held = pushToast([], refusal)
    held = pushToast(held, toast(2))
    held = pushToast(held, toast(3))
    expect(ids(held)).toEqual([1, 3])
  })

  it('drops the oldest when every notice is a refusal', () => {
    let held: ToastItem[] = []
    for (const id of [1, 2, 3]) held = pushToast(held, toast(id, true))
    expect(ids(held)).toEqual([2, 3])
  })
})

describe('spoken', () => {
  it('reads the title and each note as a sentence', () => {
    const notice: Notice = {
      title: 'Created P-1: Plan',
      notes: ['Jira added the label PSAPAC.'],
      warned: false,
    }
    expect(spoken(notice)).toBe('Created P-1: Plan. Jira added the label PSAPAC.')
    expect(spoken({ title: 'Nothing to undo.', notes: [], warned: false })).toBe('Nothing to undo.')
  })
})
