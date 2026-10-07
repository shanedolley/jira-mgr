import { z } from 'zod'

import type { FieldIds } from './state.js'

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
    statusCategory: z.object({ key: z.enum(['new', 'indeterminate', 'done', 'undefined']) }),
  }),
  resolution: z.object({ name: z.string() }).nullish(),
  parent: z.object({ key: z.string() }).nullish(),
  assignee: z
    .object({
      accountId: z.string(),
      displayName: z.string(),
      avatarUrls: z.object({ '48x48': z.string().optional() }).optional(),
    })
    .nullish(),
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
      labels: f.labels,
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
