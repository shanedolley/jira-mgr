import { z } from 'zod'

import { JiraMgrError } from './errors.js'
import type { HttpClient } from './http.js'
import { FIELD_NAMES, readFields, readSettings, type FieldIds, type FieldName } from './state.js'

/** The field name Jira shows, per resolved field. */
const FIELD_LABELS: Record<FieldName, string> = {
  customer: 'Customer',
  engagement: 'Engagement',
  sprint: 'Sprint',
  startDate: 'Start date',
  timeRemaining: 'Time remaining (h)',
}

const PAGE_SIZE = 50

const issueTypesPage = z
  .object({ total: z.number(), issueTypes: z.array(z.object({ id: z.string() })) })
  .transform((page) => ({ total: page.total, items: page.issueTypes }))

const fieldsPage = z
  .object({
    total: z.number(),
    fields: z.array(z.object({ key: z.string(), name: z.string() })),
  })
  .transform((page) => ({ total: page.total, items: page.fields }))

/** Reads every page of a listing that answers `startAt` and `maxResults` with a `total`. */
export async function fetchAll<T>(
  http: HttpClient,
  path: string,
  schema: z.ZodType<{ total: number; items: T[] }>,
): Promise<T[]> {
  const items: T[] = []
  for (;;) {
    const raw = await http.request(
      'GET',
      `${path}${path.includes('?') ? '&' : '?'}startAt=${String(items.length)}&maxResults=${String(PAGE_SIZE)}`,
    )
    const page = schema.safeParse(raw)
    if (!page.success) {
      throw new JiraMgrError(
        'jira_error',
        `Jira sent an unexpected response for ${path.split('?')[0] ?? path}.`,
        {
          details: { issues: page.error.issues },
        },
      )
    }
    items.push(...page.data.items)
    if (page.data.items.length === 0 || items.length >= page.data.total) return items
  }
}

/**
 * Finds each field's id by name in the create metadata of every issue type of `project`. A name
 * counts as found when any type lists it. An override replaces name resolution, but its id must
 * still be on one of the project's screens, so a typo fails here and not on the first write.
 * Throws `validation_failed` naming every field that is missing, ambiguous or overridden wrongly.
 */
export async function resolveFields(
  http: HttpClient,
  project: string,
  overrides: Partial<FieldIds> = {},
): Promise<FieldIds> {
  const base = `/rest/api/3/issue/createmeta/${encodeURIComponent(project)}/issuetypes`
  const types = await fetchAll(http, base, issueTypesPage)
  const perType = await Promise.all(
    types.map((type) => fetchAll(http, `${base}/${encodeURIComponent(type.id)}`, fieldsPage)),
  )
  const idsByName = new Map<string, Set<string>>()
  const onScreens = new Set<string>()
  for (const field of perType.flat()) {
    onScreens.add(field.key)
    idsByName.set(field.name, (idsByName.get(field.name) ?? new Set()).add(field.key))
  }

  const found: [FieldName, string][] = []
  const problems: string[] = []
  for (const name of FIELD_NAMES) {
    const label = FIELD_LABELS[name]
    const override = overrides[name]
    const candidates = [...(idsByName.get(label) ?? [])]
    if (override !== undefined) {
      if (onScreens.has(override)) found.push([name, override])
      else problems.push(`${label} (override ${override} is on no ${project} issue type)`)
    } else if (candidates.length === 1 && candidates[0] !== undefined) {
      found.push([name, candidates[0]])
    } else if (candidates.length === 0) {
      problems.push(`${label} (missing)`)
    } else {
      problems.push(`${label} (ambiguous: ${candidates.join(', ')})`)
    }
  }
  if (problems.length > 0) {
    throw new JiraMgrError(
      'validation_failed',
      `Cannot resolve these fields from ${project}'s create metadata: ${problems.join('; ')}. ` +
        'Set the id in "fieldOverrides" in settings.json, for example {"fieldOverrides": {"sprint": "customfield_10600"}}, then log in again.',
      { details: { problems } },
    )
  }
  // Every name was either found or reported above.
  return Object.fromEntries(found) as FieldIds
}

/** The resolved field ids, with `fieldOverrides` from settings applied. */
export async function getFieldIds(): Promise<FieldIds> {
  const [fields, settings] = await Promise.all([readFields(), readSettings()])
  if (fields === null) {
    throw new JiraMgrError('permission_denied', 'Field ids are not resolved. Run `jm auth login`.')
  }
  if (fields.site !== settings.siteUrl || fields.project !== settings.projectKey) {
    throw new JiraMgrError(
      'validation_failed',
      `fields.json holds ids for ${fields.project} on ${fields.site}, which is not the site and project in settings. Run \`jm auth login\` again.`,
    )
  }
  return { ...fields.ids, ...settings.fieldOverrides }
}
