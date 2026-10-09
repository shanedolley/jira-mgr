import type { Issue } from '@jira-mgr/core'

/** How many results the palette lists. */
export const RESULT_LIMIT = 50

/**
 * How well a query fits an issue: 0 is an exact key, 1 a key prefix or a bare number that ends
 * the key, 2 the start of the summary, 3 anywhere. `null` is no match. Every word of the query
 * must appear in the key or the summary.
 */
function rank(issue: Issue, query: string, words: readonly string[]): number | null {
  const key = issue.key.toLowerCase()
  const summary = issue.summary.toLowerCase()
  if (!words.every((w) => key.includes(w) || summary.includes(w))) return null
  if (key === query) return 0
  if (key.startsWith(query) || (/^\d+$/.test(query) && key.endsWith(`-${query}`))) return 1
  if (summary.startsWith(query)) return 2
  return 3
}

/**
 * The loaded issues that match `query` by key and summary (Q37), best first: open before Done,
 * then the most recently updated. An empty query lists the most recently updated, so the palette
 * opens on something useful. `total` counts every match, so the palette can say how many it hides.
 */
export function searchIssues(
  issues: readonly Issue[],
  query: string,
  limit = RESULT_LIMIT,
): { shown: Issue[]; total: number } {
  const text = query.trim().toLowerCase()
  const words = text.split(/\s+/).filter((w) => w !== '')
  const ranked: { issue: Issue; score: number }[] = []
  for (const issue of issues) {
    const score = words.length === 0 ? 3 : rank(issue, text, words)
    if (score !== null) ranked.push({ issue, score })
  }
  ranked.sort(
    (a, b) =>
      a.score - b.score ||
      Number(a.issue.status.category === 'done') - Number(b.issue.status.category === 'done') ||
      Date.parse(b.issue.updated) - Date.parse(a.issue.updated) ||
      a.issue.key.localeCompare(b.issue.key, 'en', { numeric: true }),
  )
  return { shown: ranked.slice(0, limit).map((r) => r.issue), total: ranked.length }
}
