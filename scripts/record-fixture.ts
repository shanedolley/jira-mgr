// Records one read-only Jira response body to packages/core/fixtures/<name>.json.
// Usage: pnpm fixture:record -- <name> <GET|POST> <path> [json-body]
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const args = process.argv.slice(2)
if (args[0] === '--') args.shift()
const [name, rawMethod, path, body] = args
if (!name || !rawMethod || !path) {
  fail('Usage: pnpm fixture:record -- <name> <GET|POST> <path> [json-body]')
}
if (!/^[a-z0-9-]+$/.test(name)) {
  fail('The fixture name uses lowercase letters, digits and hyphens.')
}

// Only reads: any GET, and the one POST that searches.
const method = rawMethod.toUpperCase()
const pathname = path.split('?')[0]
const isRead = method === 'GET' || (method === 'POST' && pathname === '/rest/api/3/search/jql')
if (!isRead) fail(`Refusing ${method} ${path}: this script records reads only.`)
if (!path.startsWith('/rest/')) fail('The path starts with /rest/.')

const { JM_JIRA_SITE, JM_JIRA_EMAIL, JM_JIRA_TOKEN } = process.env
if (!JM_JIRA_SITE || !JM_JIRA_EMAIL || !JM_JIRA_TOKEN) {
  fail('Set JM_JIRA_SITE, JM_JIRA_EMAIL and JM_JIRA_TOKEN.')
}

const response = await fetch(`${JM_JIRA_SITE}${path}`, {
  method,
  redirect: 'error',
  headers: {
    Authorization: `Basic ${Buffer.from(`${JM_JIRA_EMAIL}:${JM_JIRA_TOKEN}`).toString('base64')}`,
    Accept: 'application/json',
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  },
  body,
})
if (!response.ok) fail(`${method} ${path} returned ${String(response.status)}.`)

const outDir = new URL('../packages/core/fixtures/', import.meta.url)
mkdirSync(outDir, { recursive: true })
const file = new URL(`${name}.json`, outDir)
writeFileSync(file, `${JSON.stringify(await response.json(), null, 2)}\n`)
console.log(`Wrote ${fileURLToPath(file)}`)
