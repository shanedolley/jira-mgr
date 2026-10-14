import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { z } from 'zod'

import {
  DEFAULT_DIRECTION,
  DEFAULT_ORDER,
  DEFAULT_PROPERTIES,
  DEFAULT_TREE_LEVEL,
  ISSUE_ORDERS,
  ORDER_DIRECTIONS,
  TREE_LEVELS,
  keepKnownProperties,
} from './display.js'
import { JiraMgrError } from './errors.js'
import { DATE_WINDOWS, FILTER_LIST_FIELDS, type FilterListField } from './view-filter.js'

/** Non-secret state shared by the app and the CLI. Electron's default userData folder on macOS. */
export function stateDir(): string {
  const override = process.env.JM_STATE_DIR
  if (override !== undefined && override !== '') return override
  return join(homedir(), 'Library', 'Application Support', 'jira-mgr')
}

export const FIELD_NAMES = [
  'customer',
  'engagement',
  'sprint',
  'startDate',
  'timeRemaining',
] as const

export type FieldName = (typeof FIELD_NAMES)[number]

const fieldIds = z.object(
  Object.fromEntries(FIELD_NAMES.map((n) => [n, z.string().min(1)])) as Record<
    FieldName,
    z.ZodString
  >,
)

const toggles = z
  .object({
    hideDone: z.boolean().default(true),
    assigneeMe: z.boolean().default(false),
    hideEmptyCustomers: z.boolean().default(true),
  })
  .prefault({})

/**
 * Row properties and issue order. Every Jira request reads `settings.json`, so a value this build
 * does not know must never fail the file: unknown properties drop, an unknown order reads as `key`
 * and a `display` that is not an object reads as the defaults.
 */
const displayFields = z.object({
  properties: z
    .array(z.string())
    .catch([...DEFAULT_PROPERTIES])
    .transform(keepKnownProperties)
    .default([...DEFAULT_PROPERTIES]),
  order: z.enum(ISSUE_ORDERS).default(DEFAULT_ORDER).catch(DEFAULT_ORDER),
  direction: z.enum(ORDER_DIRECTIONS).default(DEFAULT_DIRECTION).catch(DEFAULT_DIRECTION),
})

const settingsDisplay = displayFields.prefault({}).catch(() => displayFields.parse({}))

/** A view's own display. A value this build cannot read reads as none, so the view applies no display. */
const viewDisplay = displayFields.optional().catch(undefined)

const settingsSchema = z.object({
  siteUrl: z.url().optional(),
  projectKey: z.string().min(1).optional(),
  email: z.email().optional(),
  fieldOverrides: fieldIds.partial().default({}),
  timer: z
    .object({
      rounding: z.enum(['none', '5m', '15m']).default('5m'),
      reminderThresholdHours: z.number().positive().default(8),
      reminderIntervalMinutes: z.number().positive().default(60),
    })
    .prefault({}),
  toggles,
  display: settingsDisplay,
  /** How far the Tree opens. A value this build does not know reads as Stories. */
  treeLevel: z.enum(TREE_LEVELS).default(DEFAULT_TREE_LEVEL).catch(DEFAULT_TREE_LEVEL),
})

const filterLists = z.object(
  Object.fromEntries(FILTER_LIST_FIELDS.map((f) => [f, z.array(z.string()).optional()])) as Record<
    FilterListField,
    z.ZodOptional<z.ZodArray<z.ZodString>>
  >,
)

const dateWindow = z.enum(DATE_WINDOWS)

const savedViewSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  filters: filterLists.extend({
    dates: z
      .object({
        due: z.enum(['overdue', ...DATE_WINDOWS]).optional(),
        created: dateWindow.optional(),
        updated: dateWindow.optional(),
      })
      .optional(),
    not: filterLists.optional(),
    text: z.string().optional(),
  }),
  toggles,
  display: viewDisplay,
})

const viewsSchema = z.array(savedViewSchema)

const isoTime = z.iso.datetime({ offset: true })

const timerSchema = z
  .object({
    issueKey: z.string().min(1),
    segments: z.array(z.object({ start: isoTime, end: isoTime.nullable() })),
  })
  .nullable()

const fieldsSchema = z
  .object({
    site: z.string().min(1),
    project: z.string().min(1),
    resolvedAt: isoTime,
    ids: fieldIds,
  })
  .nullable()

export type FieldIds = z.infer<typeof fieldIds>
export type Settings = z.infer<typeof settingsSchema>
export type SavedView = z.infer<typeof savedViewSchema>
export type Display = z.infer<typeof displayFields>
export type TimerState = z.infer<typeof timerSchema>
export type ResolvedFields = z.infer<typeof fieldsSchema>

/** The `Current sprint` starter's `current` sprint value matches any active sprint (see view-filter). */
const STARTER_VIEWS: SavedView[] = [
  {
    id: 'my-issues',
    name: 'My issues',
    filters: {},
    toggles: { hideDone: true, assigneeMe: true, hideEmptyCustomers: true },
  },
  {
    id: 'created-by-me',
    name: 'Created by me',
    filters: { creator: ['me'] },
    toggles: { hideDone: true, assigneeMe: false, hideEmptyCustomers: true },
  },
  {
    id: 'current-sprint',
    name: 'Current sprint',
    filters: { sprint: ['current'] },
    toggles: { hideDone: true, assigneeMe: false, hideEmptyCustomers: true },
  },
  {
    id: 'active',
    name: 'Active',
    filters: { status: ['In Progress', 'Review'] },
    toggles: { hideDone: true, assigneeMe: false, hideEmptyCustomers: true },
  },
  {
    id: 'backlog',
    name: 'Backlog',
    filters: { status: ['Opportunity', 'To Do', 'Hold'] },
    toggles: { hideDone: true, assigneeMe: false, hideEmptyCustomers: true },
  },
]

function describeIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
}

/** One JSON file in the state folder: validated on read, written atomically, `absent()` when missing. */
export function stateFile<S extends z.ZodType>(name: string, schema: S, absent: () => z.output<S>) {
  const path = () => join(stateDir(), name)

  function parse(raw: unknown, file: string, advice: string): z.output<S> {
    const result = schema.safeParse(raw)
    if (!result.success) {
      throw new JiraMgrError(
        'validation_failed',
        `${file} is invalid (${describeIssues(result.error)}). ${advice}`,
        { details: { path: file, issues: result.error.issues } },
      )
    }
    return result.data
  }

  async function read(): Promise<z.output<S>> {
    const file = path()
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return absent()
      throw new JiraMgrError('internal', `Cannot read ${file}.`, { cause })
    }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch (cause) {
      throw new JiraMgrError(
        'validation_failed',
        `${file} is not valid JSON. Fix the file or delete it to reset.`,
        { details: { path: file }, cause },
      )
    }
    return parse(raw, file, 'Fix the file or delete it to reset.')
  }

  async function write(value: z.input<S>): Promise<void> {
    const file = path()
    const data = parse(value, file, 'The value was rejected and the file is unchanged.')
    const temp = `${file}.${randomUUID()}.tmp`
    try {
      await mkdir(stateDir(), { recursive: true })
      const handle = await open(temp, 'w')
      try {
        await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`)
        // Flush to disk before the rename, so a power loss cannot leave an empty file.
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temp, file)
    } catch (cause) {
      await rm(temp, { force: true })
      throw new JiraMgrError('internal', `Cannot write ${file}.`, { cause })
    }
  }

  return { read, write }
}

const settingsFile = stateFile('settings.json', settingsSchema, () => settingsSchema.parse({}))
const viewsFile = stateFile('views.json', viewsSchema, () => structuredClone(STARTER_VIEWS))
const timerFile = stateFile('timer.json', timerSchema, () => null)
const fieldsFile = stateFile('fields.json', fieldsSchema, () => null)

export const readSettings = settingsFile.read
export const writeSettings = settingsFile.write
/** Returns the starter views when `views.json` is absent. */
export const readViews = viewsFile.read
export const writeViews = viewsFile.write
/** Returns `null` when no timer runs. */
export const readTimer = timerFile.read
export const writeTimer = timerFile.write
/** Returns `null` when the field ids have not been resolved yet. */
export const readFields = fieldsFile.read
export const writeFields = fieldsFile.write

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'view'

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function cleanName(name: string, views: SavedView[], ownId?: string): string {
  const trimmed = name.trim()
  if (trimmed === '') throw new JiraMgrError('validation_failed', 'A view name cannot be empty.')
  if (views.some((v) => v.id !== ownId && sameName(v.name, trimmed))) {
    throw new JiraMgrError('validation_failed', `A view named "${trimmed}" already exists.`)
  }
  return trimmed
}

function locate(views: SavedView[], idOrName: string): SavedView {
  const found =
    views.find((v) => v.id === idOrName) ?? views.find((v) => sameName(v.name, idOrName))
  if (found === undefined) throw new JiraMgrError('not_found', `No view "${idOrName}".`)
  return found
}

/** The view with this id, or failing that this name (any case). Throws `not_found`. */
export async function findView(idOrName: string): Promise<SavedView> {
  return locate(await readViews(), idOrName)
}

/**
 * Adds a view. Its id is the name as a slug (`Bugs this week` is `bugs-this-week`), numbered when
 * taken. Names are trimmed, non-empty and unique in any case, else `validation_failed`.
 */
// ponytail: read-modify-write with no lock, so the app and the CLI writing at once can lose an edit.
export async function createView(
  name: string,
  view: Pick<SavedView, 'filters' | 'toggles' | 'display'>,
): Promise<SavedView> {
  const views = await readViews()
  const clean = cleanName(name, views)
  const base = slug(clean)
  let id = base
  for (let n = 2; views.some((v) => v.id === id); n++) id = `${base}-${String(n)}`
  const created: SavedView = {
    id,
    name: clean,
    filters: view.filters,
    toggles: view.toggles,
    ...(view.display === undefined ? {} : { display: view.display }),
  }
  await writeViews([...views, created])
  return created
}

/** Renames a view, found by id or name; the id stays. Throws `not_found` or `validation_failed`. */
export async function renameView(idOrName: string, name: string): Promise<SavedView> {
  const views = await readViews()
  const old = locate(views, idOrName)
  const renamed = { ...old, name: cleanName(name, views, old.id) }
  await writeViews(views.map((v) => (v === old ? renamed : v)))
  return renamed
}

/**
 * Replaces a view's filters and toggles, and its display when one is given, found by id or name;
 * the id, name and place stay. Throws `not_found`.
 */
export async function updateView(
  idOrName: string,
  view: Pick<SavedView, 'filters' | 'toggles' | 'display'>,
): Promise<SavedView> {
  const views = await readViews()
  const old = locate(views, idOrName)
  const updated: SavedView = {
    ...old,
    filters: view.filters,
    toggles: view.toggles,
    ...(view.display === undefined ? {} : { display: view.display }),
  }
  await writeViews(views.map((v) => (v === old ? updated : v)))
  return updated
}

/**
 * Copies a view, found by id or name, to just after it. The copy is named `<name> copy`, then
 * `<name> copy 2` and so on when taken, and takes its id like `createView`. Throws `not_found`.
 */
export async function duplicateView(idOrName: string): Promise<SavedView> {
  const views = await readViews()
  const old = locate(views, idOrName)
  let name = `${old.name} copy`
  for (let n = 2; views.some((v) => sameName(v.name, name)); n++)
    name = `${old.name} copy ${String(n)}`
  const base = slug(name)
  let id = base
  for (let n = 2; views.some((v) => v.id === id); n++) id = `${base}-${String(n)}`
  const copy = { ...structuredClone(old), id, name }
  await writeViews(views.toSpliced(views.indexOf(old) + 1, 0, copy))
  return copy
}

/**
 * Moves a view, found by id or name, to a zero-based position and returns the new order. The
 * order is the array in `views.json`. Throws `not_found`, or `validation_failed` when `toIndex`
 * is not a position in the list.
 */
export async function moveView(idOrName: string, toIndex: number): Promise<SavedView[]> {
  const views = await readViews()
  const old = locate(views, idOrName)
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= views.length) {
    throw new JiraMgrError(
      'validation_failed',
      `Position ${String(toIndex)} is outside the ${String(views.length)} views.`,
    )
  }
  const moved = views.toSpliced(views.indexOf(old), 1).toSpliced(toIndex, 0, old)
  await writeViews(moved)
  return moved
}

/** Deletes a view, found by id or name, the last one included. Throws `not_found`. */
export async function deleteView(idOrName: string): Promise<void> {
  const views = await readViews()
  const old = locate(views, idOrName)
  await writeViews(views.filter((v) => v !== old))
}

/**
 * Refuses an issue key outside the project in settings, since a client manages that project
 * only. Throws before any request: `permission_denied` when no project is set, and
 * `validation_failed` when the key belongs to another project.
 */
export async function assertInProject(key: string): Promise<void> {
  const { projectKey } = await readSettings()
  if (projectKey === undefined) {
    throw new JiraMgrError('permission_denied', 'No project is set. Run `jm auth login`.')
  }
  const project = key.slice(0, key.lastIndexOf('-'))
  if (project !== projectKey.toUpperCase()) {
    throw new JiraMgrError(
      'validation_failed',
      `${key} is not in ${projectKey}. jm manages the ${projectKey} project only.`,
    )
  }
}
