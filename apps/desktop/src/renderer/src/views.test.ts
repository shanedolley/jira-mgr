import { describe, expect, it } from 'vitest'

import type { SavedView, Toggles } from '../../shared/ipc'
import { activeView, movedView, viewDisplayMatches, viewMatches } from './views'

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

  it('tells a view apart by its excluded values and its dates', () => {
    const wide = view('wide', {
      status: ['Done'],
      not: { status: ['Hold', 'Review'] },
      dates: { due: 'overdue' },
    })
    const same: SavedView['filters'] = {
      status: ['Done'],
      not: { status: ['Review', 'Hold'] },
      dates: { due: 'overdue' },
    }
    expect(activeView([wide], same, TOGGLES)).toBe(wide)
    expect(activeView([wide], { ...same, not: { status: ['Hold'] } }, TOGGLES)).toBeUndefined()
    expect(activeView([wide], { ...same, dates: { due: 'today' } }, TOGGLES)).toBeUndefined()
    // "is Hold" and "is not Hold" are different views.
    const hold = view('hold', { status: ['Hold'] })
    expect(activeView([hold], { not: { status: ['Hold'] } }, TOGGLES)).toBeUndefined()
  })

  it('finds none before the toggles load', () => {
    expect(activeView([sprint], { sprint: ['current'] }, undefined)).toBeUndefined()
  })

  it('takes the view applied last out of equal twins, else the first', () => {
    const twin = view('twin', { sprint: ['current'] })
    const bar = { sprint: ['current'] }
    expect(activeView([sprint, twin], bar, TOGGLES)).toBe(sprint)
    expect(activeView([sprint, twin], bar, TOGGLES, 'twin')).toBe(twin)
    expect(activeView([sprint, twin], bar, TOGGLES, 'sprint')).toBe(sprint)
    // An applied view the bar no longer matches does not win.
    expect(activeView([sprint, twin, mine], bar, TOGGLES, 'mine')).toBe(sprint)
    expect(activeView([sprint, twin], bar, TOGGLES, 'gone')).toBe(sprint)
  })
})

describe('viewMatches', () => {
  it('is true for a twin of the bar and false for another view', () => {
    expect(viewMatches(sprint, { sprint: ['current'] }, TOGGLES)).toBe(true)
    expect(
      viewMatches(view('twin', { sprint: ['current'] }), { sprint: ['current'] }, TOGGLES),
    ).toBe(true)
    expect(viewMatches(mine, { sprint: ['current'] }, TOGGLES)).toBe(false)
  })
})

describe('viewDisplayMatches', () => {
  const display = {
    properties: ['updated' as const],
    order: 'key' as const,
    direction: 'desc' as const,
  }
  const saved = { ...sprint, display }

  it('matches the display the view holds, and the defaults for a view with none', () => {
    expect(viewDisplayMatches(saved, display)).toBe(true)
    expect(viewDisplayMatches(sprint, display)).toBe(true)
  })

  it('stops matching when only the direction changes', () => {
    expect(viewDisplayMatches(saved, { ...display, direction: 'asc' })).toBe(false)
    expect(viewDisplayMatches(sprint, { ...display, direction: 'asc' })).toBe(false)
  })

  it('stops matching when a column width differs, and treats a missing width as the default', () => {
    const wide = { ...display, widths: { updated: 120 } }
    const held = { ...sprint, display: wide }
    expect(viewDisplayMatches(held, wide)).toBe(true)
    expect(viewDisplayMatches(held, display)).toBe(false)
    expect(viewDisplayMatches(saved, wide)).toBe(false)
    expect(viewDisplayMatches(saved, { ...display, widths: { updated: 72 } })).toBe(true)
  })

  it('stops matching when only the order of the columns differs', () => {
    const two = { ...display, properties: ['labels' as const, 'due' as const] }
    const held = { ...sprint, display: two }
    expect(viewDisplayMatches(held, two)).toBe(true)
    expect(viewDisplayMatches(held, { ...two, properties: ['due', 'labels'] })).toBe(false)
  })

  it('stops matching when the manual order differs, and only under Manual', () => {
    const manual = { ...display, order: 'manual' as const, direction: 'asc' as const }
    const held = { ...sprint, display: { ...manual, manual: ['P-2', 'P-1'] } }
    expect(viewDisplayMatches(held, { ...manual, manual: ['P-2', 'P-1'] })).toBe(true)
    expect(viewDisplayMatches(held, { ...manual, manual: ['P-1', 'P-2'] })).toBe(false)
    expect(viewDisplayMatches(held, manual)).toBe(false)
    // Under another order the list is not read, so a leftover one changes nothing.
    expect(viewDisplayMatches(saved, { ...display, manual: ['P-1'] })).toBe(true)
  })
})

describe('movedView', () => {
  const list = [mine, sprint, bugs]
  const ids = (views: SavedView[]) => views.map((v) => v.id)

  it('moves a view down or up to the index it takes', () => {
    expect(ids(movedView(list, 'mine', 2))).toEqual(['sprint', 'bugs', 'mine'])
    expect(ids(movedView(list, 'bugs', 0))).toEqual(['bugs', 'mine', 'sprint'])
  })

  it('leaves the order alone for an unknown id and does not change its input', () => {
    expect(ids(movedView(list, 'nope', 0))).toEqual(['mine', 'sprint', 'bugs'])
    expect(ids(list)).toEqual(['mine', 'sprint', 'bugs'])
  })
})
