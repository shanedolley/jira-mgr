import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { JiraMgrError } from './errors.js'
import {
  assertInProject,
  createView,
  deleteView,
  findView,
  readFields,
  readSettings,
  readTimer,
  readViews,
  renameView,
  stateDir,
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
    })
  })

  it('yields the starter views', async () => {
    const views = await readViews()
    expect(views.map((v) => v.name)).toEqual(['My issues', 'Created by me', 'Current sprint'])
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
    expect(await names()).toEqual(['My issues', 'Created by me', 'Current sprint'])
  })

  it('creates a view that persists, with a slug id and a trimmed name', async () => {
    const created = await createView('  Bugs this week ', bugs)
    expect(created).toEqual({ id: 'bugs-this-week', name: 'Bugs this week', ...bugs })
    expect(await readViews()).toEqual([...(await readViews()).slice(0, 3), created])
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
    expect(await names()).toEqual(['My issues', 'Created by me', 'Current sprint'])
  })

  it('renames by id or name, keeps the id and filters, and refuses bad names', async () => {
    const renamed = await renameView('my-issues', ' Mine ')
    expect(renamed.id).toBe('my-issues')
    expect(renamed.name).toBe('Mine')
    expect(renamed.toggles.assigneeMe).toBe(true)
    await renameView('current sprint', 'Now')
    expect(await names()).toEqual(['Mine', 'Created by me', 'Now'])
    expect((await validationError(renameView('now', 'MINE'))).code).toBe('validation_failed')
    expect((await validationError(renameView('now', ' '))).message).toContain('cannot be empty')
    expect(await names()).toEqual(['Mine', 'Created by me', 'Now'])
  })

  it('allows a rename that only changes case', async () => {
    await renameView('my-issues', 'MY ISSUES')
    expect(await names()).toEqual(['MY ISSUES', 'Created by me', 'Current sprint'])
  })

  it('refuses an unknown view with not_found', async () => {
    // Thunks, so each promise starts only when awaited and none rejects unobserved.
    const calls = [() => findView('nope'), () => renameView('nope', 'X'), () => deleteView('nope')]
    for (const call of calls) {
      expect((await validationError(call())).code).toBe('not_found')
    }
  })

  it('deletes a view by id or name, down to none, and stays empty', async () => {
    await deleteView('my-issues')
    expect(await names()).toEqual(['Created by me', 'Current sprint'])
    await deleteView('Current Sprint')
    await deleteView('created-by-me')
    expect(await readViews()).toEqual([])
    await expect(createView('Fresh', bugs)).resolves.toMatchObject({ id: 'fresh' })
    expect(await names()).toEqual(['Fresh'])
  })

  it('treats the starters as ordinary views once views.json exists', async () => {
    await createView('Extra', bugs)
    await deleteView('my-issues')
    await deleteView('created-by-me')
    await deleteView('current-sprint')
    expect(await names()).toEqual(['Extra'])
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
