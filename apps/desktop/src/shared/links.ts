const MAILTO_KEPT = ['subject', 'body', 'cc', 'bcc']

/** A link with space or a control character at either end, or a backslash anywhere, is ambiguous. */
function isAmbiguous(raw: string): boolean {
  const edges = [raw.charCodeAt(0), raw.charCodeAt(raw.length - 1)]
  return edges.some((code) => code <= 0x20 || code === 0x7f || code === 0xa0) || raw.includes('\\')
}

/**
 * The URL to open in the user's browser for a link, or `null` when the link must not open.
 * `http:`, `https:` and `mailto:` pass. Everything else fails, including a link with a leading
 * space, any case of `javascript:`, `file:`, `data:` and the backslash form of `https`. What is
 * returned is the parsed `href`, never the raw string, and a `mailto:` keeps only the
 * `subject`, `body`, `cc` and `bcc` parameters.
 */
export function externalUrl(raw: string): string | null {
  if (isAmbiguous(raw) || !URL.canParse(raw)) return null
  const url = new URL(raw)
  if (url.protocol === 'http:' || url.protocol === 'https:') return url.href
  if (url.protocol !== 'mailto:') return null
  const kept = new URLSearchParams()
  for (const [name, value] of url.searchParams) {
    if (MAILTO_KEPT.includes(name.toLowerCase())) kept.append(name.toLowerCase(), value)
  }
  const query = kept.toString()
  return `mailto:${url.pathname}${query === '' ? '' : `?${query}`}`
}

/** The site the login form starts with when settings hold none. */
export const DEFAULT_SITE_URL = 'https://engineering-collibra.atlassian.net'

/** Where an Atlassian account creates an API token. `shell:openTokenPage` opens this and nothing else. */
export const API_TOKEN_URL = 'https://id.atlassian.com/manage-profile/security/api-tokens'

/** Where Jira shows an issue: `/browse/<key>` on the logged-in site, under any path the site holds. */
export function issueUrl(siteUrl: string, key: string): string {
  const base = siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`
  return new URL(`browse/${encodeURIComponent(key)}`, base).href
}
