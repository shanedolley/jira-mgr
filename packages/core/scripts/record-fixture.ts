// Records one read-only Jira response body to packages/core/fixtures/<name>.json.
// Usage: pnpm fixture:record -- <name> <GET|POST> <path> [json-body]
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { parseSiteUrl } from '../src/site-url.ts'

const USAGE = 'Usage: pnpm fixture:record -- <name> <GET|POST> <path> [json-body]'

/** Checks the arguments and environment, then fetches one read. Throws before any request when a check fails. */
export async function record(
  rawArgs: string[],
  env: Record<string, string | undefined>,
  fetchFn: typeof fetch = fetch,
): Promise<{ name: string; data: unknown }> {
  const args = [...rawArgs]
  if (args[0] === '--') args.shift()
  const [name, rawMethod, path, body] = args
  if (!name || !rawMethod || !path) throw new Error(USAGE)
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error('The fixture name uses lowercase letters, digits and hyphens.')
  }

  // Only reads: any GET, and the one POST that searches.
  const method = rawMethod.toUpperCase()
  const pathname = path.split('?')[0]
  const isRead = method === 'GET' || (method === 'POST' && pathname === '/rest/api/3/search/jql')
  if (!isRead) throw new Error(`Refusing ${method} ${path}: this script records reads only.`)
  if (!path.startsWith('/rest/')) throw new Error('The path starts with /rest/.')

  const { JM_JIRA_SITE, JM_JIRA_EMAIL, JM_JIRA_TOKEN } = env
  if (!JM_JIRA_SITE || !JM_JIRA_EMAIL || !JM_JIRA_TOKEN) {
    throw new Error('Set JM_JIRA_SITE, JM_JIRA_EMAIL and JM_JIRA_TOKEN.')
  }
  const site = parseSiteUrl(JM_JIRA_SITE)
  if (site === null) {
    throw new Error('JM_JIRA_SITE must be https://<name>.atlassian.net. Nothing was sent.')
  }

  const response = await fetchFn(`${site}${path}`, {
    method,
    redirect: 'error',
    headers: {
      Authorization: `Basic ${Buffer.from(`${JM_JIRA_EMAIL}:${JM_JIRA_TOKEN}`).toString('base64')}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body,
  })
  if (!response.ok) throw new Error(`${method} ${path} returned ${String(response.status)}.`)
  return { name, data: await response.json() }
}

if (import.meta.main) {
  try {
    const { name, data } = await record(process.argv.slice(2), process.env)
    const outDir = new URL('../fixtures/', import.meta.url)
    mkdirSync(outDir, { recursive: true })
    const file = new URL(`${name}.json`, outDir)
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
    console.log(`Wrote ${fileURLToPath(file)}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
