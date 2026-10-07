import { z } from 'zod'

import { JiraMgrError } from './errors.js'
import { readSettings } from './state.js'

export const issueKey = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]*-[1-9]\d*$/, 'Not an issue key such as PSAPAC-12.')

/** A Jira duration such as "2h 30m" or "1w 2d". */
export const duration = z
  .string()
  .regex(/^\d+[wdhm](?: \d+[wdhm])*$/, 'Use a Jira duration such as "2h 30m".')

/** The id of a comment, worklog, link, attachment or sprint: digits, so it cannot alter a path. */
export const jiraId = z.string().regex(/^[1-9]\d*$/, 'Not a Jira id such as 10042.')

/** Throws `validation_failed` naming each bad field. Nothing has been sent yet. */
export function parseInput<T extends z.ZodType>(
  schema: T,
  input: unknown,
  what: string,
): z.output<T> {
  const parsed = schema.safeParse(input)
  if (parsed.success) return parsed.data
  const problems = parsed.error.issues.map(
    ({ path, message }) => `${path.length > 0 ? `${path.join('.')}: ` : ''}${message}`,
  )
  throw new JiraMgrError(
    'validation_failed',
    `Cannot ${what}: ${problems.join(' ')} Fix the input and try again.`,
    { details: { issues: parsed.error.issues } },
  )
}

/** Validates what Jira sent. A mismatch is Jira's fault, so it throws `jira_error`. */
export function parseResponse<T extends z.ZodType>(
  schema: T,
  raw: unknown,
  what: string,
): z.output<T> {
  const parsed = schema.safeParse(raw)
  if (parsed.success) return parsed.data
  throw new JiraMgrError('jira_error', `Jira sent an unexpected ${what} response.`, {
    details: { issues: parsed.error.issues },
  })
}

/** The project key given, else the one in settings. Throws `permission_denied` when neither is set. */
export async function projectKeyOrSettings(projectKey?: string): Promise<string> {
  const key = projectKey ?? (await readSettings()).projectKey
  if (key === undefined) {
    throw new JiraMgrError('permission_denied', 'No project is set. Run `jm auth login`.')
  }
  return parseInput(
    z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'Not a project key such as PSAPAC.'),
    key,
    'use the project',
  )
}
