import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { z } from 'zod'

import { JiraMgrError } from './errors.js'

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
})

const savedViewSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  filters: z.object({
    assignee: z.array(z.string()).optional(),
    status: z.array(z.string()).optional(),
    label: z.array(z.string()).optional(),
    type: z.array(z.string()).optional(),
    sprint: z.array(z.string()).optional(),
    text: z.string().optional(),
  }),
  toggles,
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
export type TimerState = z.infer<typeof timerSchema>
export type ResolvedFields = z.infer<typeof fieldsSchema>

/** The `Current sprint` starter filters on this sprint value in the list, which the client resolves. */
const STARTER_VIEWS: SavedView[] = [
  {
    id: 'my-issues',
    name: 'My issues',
    filters: {},
    toggles: { hideDone: true, assigneeMe: true, hideEmptyCustomers: true },
  },
  {
    id: 'current-sprint',
    name: 'Current sprint',
    filters: { sprint: ['current'] },
    toggles: { hideDone: true, assigneeMe: false, hideEmptyCustomers: true },
  },
]

function describeIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
}

function stateFile<S extends z.ZodType>(name: string, schema: S, absent: () => z.output<S>) {
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
