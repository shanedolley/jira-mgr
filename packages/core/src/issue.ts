import { z } from 'zod'

import type { AdfDoc } from './adf-schema.js'
import { JiraMgrError } from './errors.js'
import type { FieldIds } from './state.js'

/**
 * A user's 48x48 image from the `avatarUrls` a user carries. Only an https URL counts; anything
 * else reads as no image, so a bad avatar never fails the issue or user that carries it.
 */
export const avatarUrls = z
  .object({
    '48x48': z
      .string()
      .refine((url) => URL.canParse(url) && new URL(url).protocol === 'https:')
      .optional()
      .catch(undefined),
  })
  .optional()

/** Jira sends `+1100` offsets, which `Date` reads; the domain keeps UTC ISO text. */
export const jiraTime = z.string().transform((text, ctx) => {
  const time = new Date(text)
  if (Number.isNaN(time.getTime())) {
    ctx.addIssue({ code: 'custom', message: 'Not a date-time.' })
    return z.NEVER
  }
  return time.toISOString()
})

const option = z.object({ id: z.string(), value: z.string() })

const statusCategoryKey = z.enum(['new', 'indeterminate', 'done', 'undefined'])

/** One end of a link as an issue search carries it: the key, and the status category if sent. */
const linkedIssue = z.object({
  key: z.string(),
  fields: z
    .object({
      status: z
        .object({ statusCategory: z.object({ key: statusCategoryKey.catch('undefined') }) })
        .optional(),
    })
    .optional(),
})

const jiraLink = z.object({
  type: z.object({ name: z.string() }),
  inwardIssue: linkedIssue.optional(),
  outwardIssue: linkedIssue.optional(),
})

/** The fields core reads from a Jira issue. Unknown fields pass through unread. */
const jiraFields = z.object({
  summary: z.string(),
  issuetype: z.object({
    id: z.string(),
    name: z.string(),
    subtask: z.boolean(),
    hierarchyLevel: z.number(),
  }),
  status: z.object({
    id: z.string(),
    name: z.string(),
    statusCategory: z.object({ key: statusCategoryKey }),
  }),
  resolution: z.object({ name: z.string() }).nullish(),
  parent: z.object({ key: z.string() }).nullish(),
  assignee: z
    .object({
      accountId: z.string(),
      displayName: z.string(),
      avatarUrls,
    })
    .nullish(),
  creator: z.object({ accountId: z.string(), displayName: z.string() }).nullish(),
  issuelinks: z.array(jiraLink).nullish(),
  labels: z.array(z.string()),
  priority: z.object({ id: z.string(), name: z.string() }).nullish(),
  timetracking: z
    .object({
      originalEstimateSeconds: z.number().optional(),
      remainingEstimateSeconds: z.number().optional(),
    })
    .nullish(),
  duedate: z.string().nullish(),
  created: jiraTime,
  updated: jiraTime,
  customer: option.nullish(),
  engagement: option.nullish(),
  sprint: z.array(z.object({ id: z.number(), name: z.string(), state: z.string() })).nullish(),
  startDate: z.string().nullish(),
  timeRemaining: z.number().nullish(),
})

/**
 * Jira's raw issue, with the resolved custom field ids renamed to `customer`, `engagement`,
 * `sprint`, `startDate` and `timeRemaining`, mapped to the domain `Issue`. The description is
 * left out: it loads per issue.
 */
export function issueSchema(ids: FieldIds) {
  return z
    .object({
      id: z.string(),
      key: z.string(),
      fields: z.preprocess((raw) => {
        if (typeof raw !== 'object' || raw === null) return raw
        const fields = raw as Record<string, unknown>
        return {
          ...fields,
          customer: fields[ids.customer],
          engagement: fields[ids.engagement],
          sprint: fields[ids.sprint],
          startDate: fields[ids.startDate],
          timeRemaining: fields[ids.timeRemaining],
        }
      }, jiraFields),
    })
    .transform(({ id, key, fields: f }) => ({
      id,
      key,
      summary: f.summary,
      issueType: f.issuetype,
      status: { id: f.status.id, name: f.status.name, category: f.status.statusCategory.key },
      resolution: f.resolution?.name ?? null,
      parentKey: f.parent?.key ?? null,
      assignee:
        f.assignee == null
          ? null
          : {
              accountId: f.assignee.accountId,
              displayName: f.assignee.displayName,
              avatarUrl: f.assignee.avatarUrls?.['48x48'] ?? null,
            },
      creator: f.creator ?? null,
      labels: f.labels,
      links: (f.issuelinks ?? []).flatMap((link) => {
        const end = link.outwardIssue ?? link.inwardIssue
        if (end === undefined) return []
        return [
          {
            type: link.type.name,
            direction: link.outwardIssue === undefined ? ('inward' as const) : ('outward' as const),
            key: end.key,
            category: end.fields?.status?.statusCategory.key ?? ('undefined' as const),
          },
        ]
      }),
      priority: f.priority ?? null,
      customer: f.customer ?? null,
      engagement: f.engagement ?? null,
      sprints: f.sprint ?? [],
      startDate: f.startDate ?? null,
      dueDate: f.duedate ?? null,
      originalEstimateSeconds: f.timetracking?.originalEstimateSeconds ?? null,
      remainingEstimateSeconds: f.timetracking?.remainingEstimateSeconds ?? null,
      timeRemainingHours: f.timeRemaining ?? null,
      created: f.created,
      updated: f.updated,
    }))
}

export type Issue = z.infer<ReturnType<typeof issueSchema>>

/** An issue read on its own: the searches leave out the description and the subtasks. */
export interface IssueDetail extends Issue {
  /** The description as Atlassian Document Format, or `null` when the issue has none. */
  description: AdfDoc | null
  subtasks: { key: string; summary: string; status: string }[]
}

/** Q23: a type change is allowed only among these three, which share a hierarchy level. */
export const SWAPPABLE_TYPES = ['Story', 'Task', 'Bug'] as const

export type SwappableType = (typeof SWAPPABLE_TYPES)[number]

/** A Jira duration such as "2h 30m" or "1w 2d". */
export const DURATION_PATTERN = /^\d+[wdhm](?: \d+[wdhm])*$/

/** What an issue's type lets a client show and edit. Pure, so every client applies the same rules. */
export interface PropertyRules {
  /** Q20: an Epic or a Subtask has no Sprint. */
  sprint: boolean
  /** The estimates and Time remaining (h): an Epic has no time tracking. */
  estimates: boolean
  /** An Epic has no parent; every other type does. */
  parent: boolean
  /** Q23: only a Story, Task or Bug can change type. */
  typeChange: boolean
}

export function propertyRules(type: Pick<Issue['issueType'], 'name' | 'subtask'>): PropertyRules {
  const epic = type.name === 'Epic'
  return {
    sprint: !epic && !type.subtask,
    estimates: !epic,
    parent: !epic,
    typeChange: (SWAPPABLE_TYPES as readonly string[]).includes(type.name),
  }
}

type Typed = Pick<Issue, 'key'> & {
  issueType: Pick<Issue['issueType'], 'subtask' | 'hierarchyLevel'>
}

/**
 * The issues `issue` may take as its parent: Epics for a Story, Task or Bug, and any of those
 * three for a Subtask. An Epic has none. Never the issue itself.
 */
export function parentCandidates<T extends Typed>(issue: Typed, issues: readonly T[]): T[] {
  if (issue.issueType.hierarchyLevel >= 1) return []
  return issues.filter(({ key, issueType }) =>
    key === issue.key
      ? false
      : issue.issueType.subtask
        ? !issueType.subtask && issueType.hierarchyLevel === 0
        : issueType.hierarchyLevel >= 1,
  )
}

const UNIT_SECONDS = { w: 5 * 8 * 3600, d: 8 * 3600, h: 3600, m: 60 } as const

/**
 * A Jira duration in seconds, or `null` when `text` is not one. Assumes Jira's default of 8 hours
 * to a day and 5 days to a week, so a site that configures otherwise differs until Jira answers.
 */
// ponytail: default working time, read the site's time tracking configuration if one differs.
export function parseEstimate(text: string): number | null {
  const trimmed = text.trim()
  if (!DURATION_PATTERN.test(trimmed)) return null
  return trimmed
    .split(' ')
    .reduce(
      (sum, part) =>
        sum + Number.parseInt(part, 10) * UNIT_SECONDS[part.slice(-1) as keyof typeof UNIT_SECONDS],
      0,
    )
}

/** Seconds as hours and minutes, such as `1h 30m`. Hours and minutes alone need no working-day length. */
export function formatEstimate(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h === 0 && m === 0
    ? '0m'
    : [h > 0 && `${String(h)}h`, m > 0 && `${String(m)}m`].filter(Boolean).join(' ')
}

/**
 * Q23: throws `validation_failed` unless a type of `currentType` may change, which only a Story,
 * Task or Bug can. The CLI and the desktop app call it before they edit a type.
 */
export function assertTypeChangeAllowed(key: string, currentType: string): void {
  if ((SWAPPABLE_TYPES as readonly string[]).includes(currentType)) return
  throw new JiraMgrError(
    'validation_failed',
    `${key} is ${/^[AEIOU]/i.test(currentType) ? 'an' : 'a'} ${currentType}. The type can change only among Story, Task and Bug.`,
  )
}
