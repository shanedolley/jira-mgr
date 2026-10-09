import { describe, expect, it } from 'vitest'

import type { SavedView, Toggles } from '../../shared/ipc'
import { activeView } from './views'

const TOGGLES: Toggles = { hideDone: true, assigneeMe: false, hideEmptyCustomers: true }
const view = (id: string, filters: SavedView['filters'], toggles = TOGGLES): SavedView => ({
  id,
  name: id,
  filters,
  toggles,
})

const mine = view('mine', {}, { ...TOGGLES, assigneeMe: true })
const sprint = view('sprint', { sprint: ['current'] })
const bugs = view('bugs', { type: ['Bug', 'Task'], text: 'etl' })

describe('activeView', () => {
  it('finds the view whose filters and toggles equal the current ones', () => {
    expect(activeView([mine, sprint], { sprint: ['current'] }, TOGGLES)).toBe(sprint)
    expect(activeView([mine, sprint], {}, { ...TOGGLES, assigneeMe: true })).toBe(mine)
  })

  it('finds none when a filter differs', () => {
    expect(activeView([sprint], { sprint: ['current'], text: 'x' }, TOGGLES)).toBeUndefined()
    expect(activeView([sprint], { sprint: ['5'] }, TOGGLES)).toBeUndefined()
    expect(activeView([sprint], {}, TOGGLES)).toBeUndefined()
  })

  it('finds none when a toggle differs', () => {
    expect(
      activeView([sprint], { sprint: ['current'] }, { ...TOGGLES, hideDone: false }),
    ).toBeUndefined()
    expect(activeView([mine], {}, TOGGLES)).toBeUndefined()
  })

  it('ignores the order of values and the spaces around text', () => {
    expect(activeView([bugs], { type: ['Task', 'Bug'], text: ' etl ' }, TOGGLES)).toBe(bugs)
  })

  it('does not count a subset or a superset of values as equal', () => {
    expect(activeView([bugs], { type: ['Bug'], text: 'etl' }, TOGGLES)).toBeUndefined()
    expect(
      activeView([bugs], { type: ['Bug', 'Task', 'Epic'], text: 'etl' }, TOGGLES),
    ).toBeUndefined()
  })

  it('treats an empty list like an absent field', () => {
    expect(activeView([mine], { label: [] }, { ...TOGGLES, assigneeMe: true })).toBe(mine)
  })

  it('finds none before the toggles load, and takes the first of two equal views', () => {
    expect(activeView([sprint], { sprint: ['current'] }, undefined)).toBeUndefined()
    const twin = view('twin', { sprint: ['current'] })
    expect(activeView([sprint, twin], { sprint: ['current'] }, TOGGLES)).toBe(sprint)
  })
})
