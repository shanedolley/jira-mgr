// No imports: the fixture recorder runs this file under plain node.

/** The origin of an `https://<name>.atlassian.net` site URL, or `null` for anything else. */
export function parseSiteUrl(value: string): string | null {
  if (!URL.canParse(value)) return null
  const url = new URL(value)
  const ok =
    url.protocol === 'https:' &&
    /^[a-z0-9-]+\.atlassian\.net$/i.test(url.hostname) &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === ''
  return ok ? url.origin : null
}

/** Whether `path` stays under `/rest/` on the site: no `..`, backslash or encoded dot. */
export function isJiraPath(path: string): boolean {
  // The query and fragment cannot change which endpoint is called, and a search may hold "..".
  const pathname = path.split(/[?#]/, 1)[0] ?? ''
  return path.startsWith('/rest/') && !/\.\.|%2e/i.test(pathname) && !pathname.includes('\\')
}
