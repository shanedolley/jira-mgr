import { z } from 'zod'

import { JiraMgrError } from './errors.js'
import { fetchAll, getFieldIds } from './fields.js'
import type { HttpClient } from './http.js'
import {
  currentUser,
  parseInput,
  parseResponse,
  projectKeyOrSettings,
  type CurrentUser,
} from './validate.js'

export type { CurrentUser }

const MAX_USERS = 50
const searchText = z.string().max(200)

const suggestions = z.object({ results: z.array(z.object({ value: z.string() })) })

/**
 * Labels that start with `prefix`, as Jira suggests them. The suggestions come from every
 * project on the site, not only the current one. An empty prefix returns Jira's first few.
 */
export async function suggestLabels(http: HttpClient, prefix: string): Promise<string[]> {
  const text = parseInput(searchText, prefix, 'suggest labels')
  const raw = await http.request(
    'GET',
    `/rest/api/3/jql/autocompletedata/suggestions?fieldName=labels&fieldValue=${encodeURIComponent(text)}`,
  )
  return parseResponse(suggestions, raw, 'label suggestions').results.map((r) => r.value)
}

/** The account the stored token authenticates as. Throws `permission_denied` when Jira rejects it. */
export async function getCurrentUser(
  http: HttpClient,
  options: { signal?: AbortSignal } = {},
): Promise<CurrentUser> {
  const raw = await http.request('GET', '/rest/api/3/myself', options)
  return parseResponse(currentUser, raw, 'current user')
}

const assignableUsers = z.array(
  z.object({
    accountId: z.string(),
    displayName: z.string(),
    active: z.boolean(),
    avatarUrls: z.object({ '48x48': z.string().optional() }).optional(),
  }),
)

export interface AssignableUser {
  accountId: string
  displayName: string
  avatarUrl: string | null
}

/**
 * Active users who can be assigned issues in the project (settings unless `projectKey` is given)
 * whose name or email matches `query`. Jira returns at most 50.
 */
export async function searchAssignableUsers(
  http: HttpClient,
  query: string,
  options: { projectKey?: string } = {},
): Promise<AssignableUser[]> {
  const text = parseInput(searchText, query, 'search users')
  const project = await projectKeyOrSettings(options.projectKey)
  const raw = await http.request(
    'GET',
    `/rest/api/3/user/assignable/search?project=${encodeURIComponent(project)}&query=${encodeURIComponent(text)}&maxResults=${String(MAX_USERS)}`,
  )
  return parseResponse(assignableUsers, raw, 'assignable users')
    .filter((user) => user.active)
    .map((user) => ({
      accountId: user.accountId,
      displayName: user.displayName,
      avatarUrl: user.avatarUrls?.['48x48'] ?? null,
    }))
}

export const FIELD_OPTION_FIELDS = [
  'customer',
  'engagement',
  'priority',
  'issueType',
  'status',
] as const

export type FieldOptionField = (typeof FIELD_OPTION_FIELDS)[number]

export interface FieldOption {
  id: string
  name: string
}

const issueTypesPage = z
  .object({
    total: z.number(),
    issueTypes: z.array(z.object({ id: z.string(), name: z.string() })),
  })
  .transform((page) => ({ total: page.total, items: page.issueTypes }))

const option = z
  .object({ id: z.string(), value: z.string().optional(), name: z.string().optional() })
  .transform((o) => ({ id: o.id, name: o.value ?? o.name ?? o.id }))

const fieldsPage = z
  .object({
    total: z.number(),
    fields: z.array(z.object({ key: z.string(), allowedValues: z.array(option).optional() })),
  })
  .transform((page) => ({ total: page.total, items: page.fields }))

const projectStatuses = z.array(
  z.object({ statuses: z.array(z.object({ id: z.string(), name: z.string() })) }),
)

/**
 * The values a field accepts in the project. Customer, Engagement and Priority read the create
 * metadata, so Priority lists the project's own priorities, not every one on the site. `status`
 * lists the statuses across the issue types, each once.
 */
export async function getFieldOptions(
  http: HttpClient,
  field: FieldOptionField,
  options: { projectKey?: string } = {},
): Promise<FieldOption[]> {
  const name = parseInput(z.enum(FIELD_OPTION_FIELDS), field, 'list field options')
  const project = await projectKeyOrSettings(options.projectKey)
  const path = encodeURIComponent(project)

  if (name === 'status') {
    const raw = await http.request('GET', `/rest/api/3/project/${path}/statuses`)
    const all = parseResponse(projectStatuses, raw, 'statuses').flatMap((type) => type.statuses)
    return [...new Map(all.map((status) => [status.id, status])).values()]
  }

  const base = `/rest/api/3/issue/createmeta/${path}/issuetypes`
  const types = await fetchAll(http, base, issueTypesPage)
  if (name === 'issueType') return types

  const key = name === 'priority' ? 'priority' : (await getFieldIds())[name]
  for (const type of types) {
    const fields = await fetchAll(http, `${base}/${encodeURIComponent(type.id)}`, fieldsPage)
    const found = fields.find((f) => f.key === key)?.allowedValues
    if (found !== undefined) return found
  }
  throw new JiraMgrError(
    'validation_failed',
    `No ${project} issue type lists options for ${name} (${key}).`,
  )
}
