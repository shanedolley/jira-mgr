import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { JiraMgrError } from './errors.js'
import {
  assertInProject,
  createView,
  deleteView,
  duplicateView,
  findView,
  moveView,
  readFields,
  readSettings,
  readTimer,
  readViews,
  renameView,
  stateDir,
  updateView,
  writeFields,
  writeSettings,
  writeTimer,
  writeViews,
} from './state.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jm-state-'))
  process.env.JM_STATE_DIR = dir
})

afterEach(async () => {
  delete process.env.JM_STATE_DIR
  await rm(dir, { recursive: true, force: true })
})

async function validationError(promise: Promise<unknown>): Promise<JiraMgrError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(JiraMgrError)
  return error as JiraMgrError
}

describe('stateDir', () => {
  it('defaults to the Application Support folder', () => {
    delete process.env.JM_STATE_DIR
    expect(stateDir()).toMatch(/Library\/Application Support\/jira-mgr$/)
  })

  it('ignores an empty JM_STATE_DIR', () => {
    process.env.JM_STATE_DIR = ''
    expect(stateDir()).toMatch(/Library\/Application Support\/jira-mgr$/)
  })

  it('honours JM_STATE_DIR', () => {
    expect(stateDir()).toBe(dir)
  })
})

describe('absent files', () => {
  it('yields default settings', async () => {
    expect(await readSettings()).toEqual({
      fieldOverrides: {},
      timer: { rounding: '5m', reminderThresholdHours: 8, reminderIntervalMinutes: 60 },
      toggles: { hideDone: true, assigneeMe: false, hideEmptyCustomers: true },
      display: { properties: ['updated'], order: 'key', direction: 'desc' },
      treeLevel: 'stories',
    })
  })

  it('yields the starter views', async () => {
    const views = await readViews()
    expect(views.map((v) => v.name)).toEqual([
      'My issues',
      'Created by me',
      'Current sprint',
      'Active',
      'Backlog',
    ])
  })

  it('yields null for the timer and the resolved fields', async () => {
    expect(await readTimer()).toBeNull()
    expect(await readFields()).toBeNull()
  })
})

describe('round trip', () => {
  it('keeps settings', async () => {
    const settings = await readSettings()
    settings.siteUrl = 'https://engineering-collibra.atlassian.net'
    settings.projectKey = 'PSAPAC'
    settings.email = 'a@example.com'
    settings.fieldOverrides = { sprint: 'customfield_1' }
    settings.timer.rounding = '15m'
    settings.toggles.hideDone = false
    await writeSettings(settings)
    expect(await readSettings()).toEqual(settings)
  })

  it('keeps views', async () => {
    const views = await readViews()
    views.push({
      id: 'v3',
      name: 'Bugs',
      filters: { type: ['Bug', 'Task'], status: ['To Do'], text: 'login' },
      toggles: { hideDone: false, assigneeMe: true, hideEmptyCustomers: false },
    })
    await writeViews(views)
    expect(await readViews()).toEqual(views)
  })

  it('keeps the new filter keys, the dates and the excluded values', async () => {
    const views = [
      {
        id: 'v4',
        name: 'Everything',
        filters: {
          status: ['Done'],
          customer: ['BHP'],
          engagement: ['ETL'],
          priority: ['High'],
          epic: ['PSAPAC-1792'],
          creator: ['me'],
          statusType: ['indeterminate'],
          relations: ['blocked'],
          dates: { due: 'overdue' as const, created: 'last-7-days' as const },
          not: { status: ['Hold'], label: ['etl'], relations: ['blocking'] },
        },
        toggles: { hideDone: true, assigneeMe: false, hideEmptyCustomers: true },
      },
    ]
    await writeViews(views)
    expect(await readViews()).toEqual(views)
  })

  it('keeps a paused timer and clears it', async () => {
    const timer = {
      issueKey: 'PSAPAC-1',
      segments: [
        { start: '2026-10-07T01:00:00.000Z', end: '2026-10-07T02:00:00.000Z' },
        { start: '2026-10-07T03:00:00.000Z', end: null },
      ],
    }
    await writeTimer(timer)
    expect(await readTimer()).toEqual(timer)
    await writeTimer(null)
    expect(await readTimer()).toBeNull()
  })

  it('keeps resolved fields', async () => {
    const fields = {
      site: 'https://engineering-collibra.atlassian.net',
      project: 'PSAPAC',
      resolvedAt: '2026-10-07T01:00:00.000Z',
      ids: {
        customer: 'customfield_14849',
        engagement: 'customfield_14850',
        sprint: 'customfield_10600',
        startDate: 'customfield_13808',
        timeRemaining: 'customfield_1',
      },
    }
    await writeFields(fields)
    expect(await readFields()).toEqual(fields)
  })
})

describe('corrupt files', () => {
  it('rejects a corrupt fields.json, naming the file', async () => {
    await writeFile(join(dir, 'fields.json'), JSON.stringify({ site: 'x' }))
    const error = await validationError(readFields())
    expect(error.code).toBe('validation_failed')
    expect(error.message).toContain(join(dir, 'fields.json'))
  })

  it('rejects a single-string filter', async () => {
    const view = { id: 'v', name: 'V', filters: { type: 'Bug' }, toggles: {} }
    await writeFile(join(dir, 'views.json'), JSON.stringify([view]))
    const error = await validationError(readViews())
    expect(error.message).toContain('filters.type')
  })

  it('reads a views file written before the new filter keys, unchanged', async () => {
    const old = [
      {
        id: 'bugs',
        name: 'Bugs',
        filters: {
          assignee: ['me'],
          status: ['To Do'],
          label: ['etl'],
          type: ['Bug'],
          sprint: ['current'],
          text: 'x',
        },
        toggles: { hideDone: true, assigneeMe: false, hideEmptyCustomers: true },
      },
    ]
    await writeFile(join(dir, 'views.json'), JSON.stringify(old))
    expect(await readViews()).toEqual(old)
  })

  it.each([
    ['an unknown date window', { dates: { due: 'soon' } }, 'filters.dates.due'],
    ['overdue on Created', { dates: { created: 'overdue' } }, 'filters.dates.created'],
    ['a single string in not', { not: { status: 'Hold' } }, 'filters.not.status'],
    ['a single string in a new field', { customer: 'BHP' }, 'filters.customer'],
  ])('rejects %s', async (_name, filters, path) => {
    const view = { id: 'v', name: 'V', filters, toggles: {} }
    await writeFile(join(dir, 'views.json'), JSON.stringify([view]))
    const error = await validationError(readViews())
    expect(error.code).toBe('validation_failed')
    expect(error.message).toContain(path)
  })

  it('rejects bad JSON, naming the file', async () => {
    await writeFile(join(dir, 'settings.json'), '{ nope')
    const error = await validationError(readSettings())
    expect(error.code).toBe('validation_failed')
    expect(error.message).toContain(join(dir, 'settings.json'))
  })

  it('rejects an invalid shape, naming the file', async () => {
    await writeFile(join(dir, 'views.json'), JSON.stringify([{ id: 'x' }]))
    const error = await validationError(readViews())
    expect(error.code).toBe('validation_failed')
    expect(error.message).toContain(join(dir, 'views.json'))
  })

  it('rejects an out-of-range value', async () => {
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ timer: { rounding: '7m' } }))
    const error = await validationError(readSettings())
    expect(error.message).toContain('timer.rounding')
  })

  it('refuses to write an invalid value and leaves the file alone', async () => {
    await writeTimer({ issueKey: 'PSAPAC-1', segments: [] })
    const error = await validationError(writeTimer({ issueKey: '', segments: [] }))
    expect(error.code).toBe('validation_failed')
    expect(await readTimer()).toEqual({ issueKey: 'PSAPAC-1', segments: [] })
  })
})

describe('invalid writes', () => {
  it('word the error for a rejected write and leave settings.json intact', async () => {
    const settings = await readSettings()
    settings.projectKey = 'PSAPAC'
    await writeSettings(settings)
    const error = await validationError(
      writeSettings({ ...settings, timer: { ...settings.timer, rounding: '7m' as '5m' } }),
    )
    expect(error.code).toBe('validation_failed')
    expect(error.message).toContain('file is unchanged')
    expect(error.message).not.toContain('delete it')
    expect(await readSettings()).toEqual(settings)
  })
})

describe('atomic write', () => {
  it('leaves no temp file behind', async () => {
    await writeSettings(await readSettings())
    await writeSettings(await readSettings())
    expect(await readdir(dir)).toEqual(['settings.json'])
  })
})

describe('view management', () => {
  const toggles = { hideDone: true, assigneeMe: false, hideEmptyCustomers: true }
  const bugs = { filters: { type: ['Bug'] }, toggles }
  const names = async () => (await readViews()).map((v) => v.name)

  it('starts from the starter views and finds them by id or name', async () => {
    expect((await findView('my-issues')).name).toBe('My issues')
    expect((await findView('CURRENT SPRINT')).id).toBe('current-sprint')
    expect(await names()).toEqual([
      'My issues',
      'Created by me',
      'Current sprint',
      'Active',
      'Backlog',
    ])
  })

  it('creates a view that persists, with a slug id and a trimmed name', async () => {
    const created = await createView('  Bugs this week ', bugs)
    expect(created).toEqual({ id: 'bugs-this-week', name: 'Bugs this week', ...bugs })
    expect(await readViews()).toEqual([...(await readViews()).slice(0, 5), created])
    expect(await findView('bugs-this-week')).toEqual(created)
    expect(await findView('bugs THIS week')).toEqual(created)
  })

  it('numbers an id that is taken and falls back for a name with no letters', async () => {
    expect((await createView('Q?', bugs)).id).toBe('q')
    expect((await createView('q!', bugs)).id).toBe('q-2')
    expect((await createView('???', bugs)).id).toBe('view')
  })

  it('refuses an empty or duplicate name and leaves the file unchanged', async () => {
    for (const [name, message] of [
      ['', 'cannot be empty'],
      ['   ', 'cannot be empty'],
      ['my issues', 'already exists'],
      ['CURRENT SPRINT', 'already exists'],
    ] as const) {
      const error = await validationError(createView(name, bugs))
      expect(error.code).toBe('validation_failed')
      expect(error.message).toContain(message)
    }
    expect(await names()).toEqual([
      'My issues',
      'Created by me',
      'Current sprint',
      'Active',
      'Backlog',
    ])
  })

  it('renames by id or name, keeps the id and filters, and refuses bad names', async () => {
    const renamed = await renameView('my-issues', ' Mine ')
    expect(renamed.id).toBe('my-issues')
    expect(renamed.name).toBe('Mine')
    expect(renamed.toggles.assigneeMe).toBe(true)
    await renameView('current sprint', 'Now')
    expect(await names()).toEqual(['Mine', 'Created by me', 'Now', 'Active', 'Backlog'])
    expect((await validationError(renameView('now', 'MINE'))).code).toBe('validation_failed')
    expect((await validationError(renameView('now', ' '))).message).toContain('cannot be empty')
    expect(await names()).toEqual(['Mine', 'Created by me', 'Now', 'Active', 'Backlog'])
  })

  it('allows a rename that only changes case', async () => {
    await renameView('my-issues', 'MY ISSUES')
    expect(await names()).toEqual([
      'MY ISSUES',
      'Created by me',
      'Current sprint',
      'Active',
      'Backlog',
    ])
  })

  it('refuses an unknown view with not_found', async () => {
    // Thunks, so each promise starts only when awaited and none rejects unobserved.
    const calls = [
      () => findView('nope'),
      () => renameView('nope', 'X'),
      () => deleteView('nope'),
      () => updateView('nope', bugs),
      () => duplicateView('nope'),
      () => moveView('nope', 0),
    ]
    for (const call of calls) {
      expect((await validationError(call())).code).toBe('not_found')
    }
  })

  it('deletes a view by id or name, down to none, and stays empty', async () => {
    await deleteView('my-issues')
    expect(await names()).toEqual(['Created by me', 'Current sprint', 'Active', 'Backlog'])
    for (const id of ['current-sprint', 'created-by-me', 'active', 'backlog']) await deleteView(id)
    expect(await readViews()).toEqual([])
    await expect(createView('Fresh', bugs)).resolves.toMatchObject({ id: 'fresh' })
    expect(await names()).toEqual(['Fresh'])
  })

  it('seeds Active and Backlog as starters, filtered by status', async () => {
    expect((await findView('active')).filters).toEqual({ status: ['In Progress', 'Review'] })
    expect((await findView('backlog')).filters).toEqual({
      status: ['Opportunity', 'To Do', 'Hold'],
    })
  })

  it('does not add new starters to a views.json that already exists', async () => {
    await writeFile(join(dir, 'views.json'), JSON.stringify([]))
    await createView('Mine', bugs)
    expect(await names()).toEqual(['Mine'])
  })

  it('updates the filters and toggles in place, keeping the id, name and position', async () => {
    const next = { filters: { text: 'x' }, toggles: { ...toggles, hideDone: false } }
    const updated = await updateView('Current Sprint', next)
    expect(updated).toEqual({ id: 'current-sprint', name: 'Current sprint', ...next })
    expect(await readViews()).toEqual([
      ...(await readViews()).slice(0, 2),
      updated,
      ...(await readViews()).slice(3),
    ])
    expect((await readViews()).findIndex((v) => v.id === 'current-sprint')).toBe(2)
  })

  it('refuses an update that fails the schema and leaves the file unchanged', async () => {
    await createView('Keep', bugs)
    const bad = { filters: { type: [1] as unknown as string[] }, toggles }
    expect((await validationError(updateView('keep', bad))).code).toBe('validation_failed')
    expect((await findView('keep')).filters).toEqual(bugs.filters)
  })

  it('duplicates a view to just after it, numbering a taken name and id', async () => {
    const first = await duplicateView('my-issues')
    expect(first).toMatchObject({ id: 'my-issues-copy', name: 'My issues copy' })
    expect(first.filters).toEqual((await findView('my-issues')).filters)
    expect(first.toggles).toEqual((await findView('my-issues')).toggles)
    const second = await duplicateView('MY ISSUES')
    expect(second).toMatchObject({ id: 'my-issues-copy-2', name: 'My issues copy 2' })
    expect(await names()).toEqual([
      'My issues',
      'My issues copy 2',
      'My issues copy',
      'Created by me',
      'Current sprint',
      'Active',
      'Backlog',
    ])
  })

  it('moves a view to a position, by id or name, and the order persists', async () => {
    expect((await moveView('backlog', 0)).map((v) => v.id)).toEqual([
      'backlog',
      'my-issues',
      'created-by-me',
      'current-sprint',
      'active',
    ])
    await moveView('My Issues', 4)
    expect((await readViews()).map((v) => v.id)).toEqual([
      'backlog',
      'created-by-me',
      'current-sprint',
      'active',
      'my-issues',
    ])
    await moveView('active', 3)
    expect((await readViews())[3]?.id).toBe('active')
  })

  it('refuses a position outside the list and leaves the order alone', async () => {
    for (const to of [-1, 5, 1.5, Number.NaN]) {
      expect((await validationError(moveView('active', to))).code).toBe('validation_failed')
    }
    expect(await names()).toEqual([
      'My issues',
      'Created by me',
      'Current sprint',
      'Active',
      'Backlog',
    ])
  })

  it('treats the starters as ordinary views once views.json exists', async () => {
    await createView('Extra', bugs)
    await deleteView('my-issues')
    for (const id of ['created-by-me', 'current-sprint', 'active', 'backlog']) {
      await deleteView(id)
    }
    expect(await names()).toEqual(['Extra'])
  })
})

describe('treeLevel', () => {
  it.each([
    ['missing', {}],
    ['unknown', { treeLevel: 'galaxy' }],
    ['a number', { treeLevel: 3 }],
    ['null', { treeLevel: null }],
  ])('reads a %s level as stories and never fails the file', async (_name, raw) => {
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({ siteUrl: 'https://x.test', ...raw }),
    )
    const settings = await readSettings()
    expect(settings.treeLevel).toBe('stories')
    expect(settings.siteUrl).toBe('https://x.test')
  })

  it('keeps a known level through a write', async () => {
    await writeSettings({ ...(await readSettings()), treeLevel: 'epics' })
    expect((await readSettings()).treeLevel).toBe('epics')
  })
})

describe('display', () => {
  const toggles = { hideDone: true, assigneeMe: false, hideEmptyCustomers: true }
  const display = {
    properties: ['labels' as const, 'due' as const],
    order: 'priority' as const,
    direction: 'asc' as const,
  }

  it('reads a settings file with no display as the defaults', async () => {
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ toggles }))
    expect((await readSettings()).display).toEqual({
      properties: ['updated'],
      order: 'key',
      direction: 'desc',
    })
  })

  it('keeps the properties it knows, in row order, and drops the rest', async () => {
    const raw = { display: { properties: ['updated', 'wat', 'labels', 'updated'], order: 'due' } }
    await writeFile(join(dir, 'settings.json'), JSON.stringify(raw))
    expect((await readSettings()).display).toEqual({
      properties: ['labels', 'updated'],
      order: 'due',
      direction: 'asc',
    })
  })

  it('reads the time properties in row order, and a file without them as before', async () => {
    const raw = {
      display: { properties: ['updated', 'remainingPercent', 'estimate', 'logged', 'remaining'] },
    }
    await writeFile(join(dir, 'settings.json'), JSON.stringify(raw))
    expect((await readSettings()).display.properties).toEqual([
      'estimate',
      'logged',
      'remaining',
      'remainingPercent',
      'updated',
    ])
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({ display: { properties: ['due'] } }),
    )
    expect((await readSettings()).display.properties).toEqual(['due'])
  })

  it('reads the start date in row order before the due date, and a file without it as before', async () => {
    const raw = { display: { properties: ['due', 'updated', 'start', 'labels'] } }
    await writeFile(join(dir, 'settings.json'), JSON.stringify(raw))
    expect((await readSettings()).display.properties).toEqual(['labels', 'start', 'due', 'updated'])
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({ display: { properties: ['labels', 'due'] } }),
    )
    expect((await readSettings()).display.properties).toEqual(['labels', 'due'])
  })

  it('reads an unknown order as key and never fails the file', async () => {
    const raw = { display: { properties: ['due'], order: 'rank' } }
    await writeFile(join(dir, 'settings.json'), JSON.stringify(raw))
    expect((await readSettings()).display).toEqual({
      properties: ['due'],
      order: 'key',
      direction: 'desc',
    })
  })

  it("reads a display with no direction as its order's default direction", async () => {
    const read = async (order: string) => {
      await writeFile(join(dir, 'settings.json'), JSON.stringify({ display: { order } }))
      return (await readSettings()).display.direction
    }
    expect(await read('key')).toBe('desc')
    expect(await read('priority')).toBe('desc')
    expect(await read('updated')).toBe('desc')
    expect(await read('due')).toBe('asc')
    expect(await read('status')).toBe('asc')
  })

  it("keeps a chosen direction, and reads an unknown one as the order's default", async () => {
    const raw = (order: string, direction: string) => ({
      display: { properties: [], order, direction },
    })
    await writeFile(join(dir, 'settings.json'), JSON.stringify(raw('key', 'asc')))
    expect((await readSettings()).display.direction).toBe('asc')
    await writeFile(join(dir, 'settings.json'), JSON.stringify(raw('due', 'desc')))
    expect((await readSettings()).display.direction).toBe('desc')
    await writeFile(join(dir, 'settings.json'), JSON.stringify(raw('due', 'up')))
    expect((await readSettings()).display.direction).toBe('asc')
  })

  it("reads a view display with no direction as its order's default, and keeps a chosen one", async () => {
    const view = (display: unknown) => ({ id: 'v', name: 'V', filters: {}, toggles, display })
    await writeFile(
      join(dir, 'views.json'),
      JSON.stringify([
        view({ properties: ['due'], order: 'due' }),
        { ...view({ properties: [], order: 'status', direction: 'desc' }), id: 'w', name: 'W' },
      ]),
    )
    const [old, chosen] = await readViews()
    expect(old?.display).toEqual({ properties: ['due'], order: 'due', direction: 'asc' })
    expect(chosen?.display).toEqual({ properties: [], order: 'status', direction: 'desc' })
  })

  it('reads a view with time properties, and drops one an older build does not know', async () => {
    const view = (properties: string[]) => ({
      id: 'v',
      name: 'V',
      filters: {},
      toggles,
      display: { properties, order: 'key' },
    })
    await writeFile(
      join(dir, 'views.json'),
      JSON.stringify([view(['remainingPercent', 'logged', 'wat'])]),
    )
    const [read] = await readViews()
    expect(read?.display?.properties).toEqual(['logged', 'remainingPercent'])
  })

  it('reads a view display with and without the start date', async () => {
    const view = (properties: string[]) => ({
      id: 'v',
      name: 'V',
      filters: {},
      toggles,
      display: { properties, order: 'key' },
    })
    await writeFile(
      join(dir, 'views.json'),
      JSON.stringify([view(['due', 'start', 'labels']), { ...view(['due']), id: 'w' }]),
    )
    const [withStart, without] = await readViews()
    expect(withStart?.display?.properties).toEqual(['labels', 'start', 'due'])
    expect(without?.display?.properties).toEqual(['due'])
  })

  it.each([
    ['a string', 'wide'],
    ['null', null],
    ['properties as a number', { properties: 3 }],
  ])('reads display as %s as the defaults for what it cannot read', async (_name, value) => {
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ display: value }))
    expect((await readSettings()).display).toEqual({
      properties: ['updated'],
      order: 'key',
      direction: 'desc',
    })
  })

  it('keeps display through a write and through a toggles write', async () => {
    const settings = await readSettings()
    await writeSettings({ ...settings, display })
    await writeSettings({
      ...(await readSettings()),
      toggles: { ...toggles, hideDone: false },
    })
    expect((await readSettings()).display).toEqual(display)
  })

  it('keeps a manual order through a write, and reads a file with none unchanged', async () => {
    const manual = { ...display, order: 'manual' as const, direction: 'asc' as const }
    expect((await readSettings()).display).not.toHaveProperty('manual')
    await writeSettings({
      ...(await readSettings()),
      display: { ...manual, manual: ['P-2', 'P-1'] },
    })
    expect((await readSettings()).display.manual).toEqual(['P-2', 'P-1'])
  })

  it('reads a manual order it cannot read as none, and keeps the rest of the display', async () => {
    for (const bad of ['P-1', [1, 2], { a: 1 }, Array.from({ length: 20001 }, () => 'P-1')]) {
      await writeFile(
        join(dir, 'settings.json'),
        JSON.stringify({ display: { properties: ['due'], order: 'manual', manual: bad } }),
      )
      expect((await readSettings()).display).toEqual({
        properties: ['due'],
        order: 'manual',
        direction: 'asc',
      })
    }
  })

  it('stores a manual order per view, apart from the settings', async () => {
    const one = {
      properties: [],
      order: 'manual' as const,
      direction: 'asc' as const,
      manual: ['P-2', 'P-1'],
    }
    const two = { ...one, manual: ['P-1', 'P-2'] }
    await createView('One', { filters: {}, toggles, display: one })
    await createView('Two', { filters: {}, toggles, display: two })
    expect((await findView('one')).display?.manual).toEqual(['P-2', 'P-1'])
    expect((await findView('two')).display?.manual).toEqual(['P-1', 'P-2'])
    expect((await readSettings()).display).not.toHaveProperty('manual')
    await updateView('one', { filters: {}, toggles, display: { ...one, manual: ['P-3'] } })
    expect((await findView('one')).display?.manual).toEqual(['P-3'])
    expect((await findView('two')).display?.manual).toEqual(['P-1', 'P-2'])
  })

  it('reads a views file with no display unchanged, and gives a view none', async () => {
    const old = [{ id: 'bugs', name: 'Bugs', filters: { type: ['Bug'] }, toggles }]
    await writeFile(join(dir, 'views.json'), JSON.stringify(old))
    expect(await readViews()).toEqual(old)
    expect((await readViews())[0]).not.toHaveProperty('display')
  })

  it('reads a view display leniently, and a display it cannot read as none', async () => {
    const view = (value: unknown) => ({ id: 'v', name: 'V', filters: {}, toggles, display: value })
    await writeFile(
      join(dir, 'views.json'),
      JSON.stringify([view({ properties: ['due', 'x'], order: 'rank' })]),
    )
    expect((await readViews())[0]?.display).toEqual({
      properties: ['due'],
      order: 'key',
      direction: 'desc',
    })
    await writeFile(join(dir, 'views.json'), JSON.stringify([view('wide')]))
    expect((await readViews())[0]?.display).toBeUndefined()
  })

  it('stores display on create and update, and keeps it through rename and duplicate', async () => {
    const created = await createView('Triage', { filters: {}, toggles, display })
    expect(created.display).toEqual(display)
    expect((await findView('triage')).display).toEqual(display)

    await renameView('triage', 'Triage 2')
    expect((await findView('triage')).display).toEqual(display)

    const copy = await duplicateView('triage')
    expect(copy.display).toEqual(display)

    const next = {
      properties: ['sprint' as const],
      order: 'updated' as const,
      direction: 'desc' as const,
    }
    await updateView('triage', { filters: {}, toggles, display: next })
    expect((await findView('triage')).display).toEqual(next)
    expect((await findView('triage-2-copy')).display).toEqual(display)
  })

  it('keeps a view display when an update gives none', async () => {
    await createView('Keep', { filters: {}, toggles, display })
    await updateView('keep', { filters: { text: 'x' }, toggles, display: undefined })
    expect((await findView('keep')).display).toEqual(display)
  })

  it('keeps a view display through a settings write', async () => {
    await createView('Keep', { filters: {}, toggles, display })
    await writeSettings({ ...(await readSettings()), display: { ...display, order: 'due' } })
    expect((await findView('keep')).display).toEqual(display)
  })
})

describe('assertInProject', () => {
  it('accepts a key in the settings project, in any case of the project key', async () => {
    await writeSettings({ projectKey: 'psapac' })
    await expect(assertInProject('PSAPAC-12')).resolves.toBeUndefined()
  })

  it('refuses a key from another project with validation_failed, naming both', async () => {
    await writeSettings({ projectKey: 'PSAPAC' })
    const error = await validationError(assertInProject('OTHER-5'))
    expect(error.code).toBe('validation_failed')
    expect(error.message).toBe('OTHER-5 is not in PSAPAC. jm manages the PSAPAC project only.')
  })

  it('refuses a key whose project only starts like the settings project', async () => {
    await writeSettings({ projectKey: 'PSAPAC' })
    expect((await validationError(assertInProject('PSAPACX-1'))).code).toBe('validation_failed')
  })

  it('refuses everything with permission_denied when no project is set', async () => {
    const error = await validationError(assertInProject('PSAPAC-1'))
    expect(error.code).toBe('permission_denied')
    expect(error.message).toBe('No project is set. Run `jm auth login`.')
  })
})
