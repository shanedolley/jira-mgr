import { adfToMarkdown } from '@jira-mgr/core/adf'
import { getIssue, type IssueDetail } from '@jira-mgr/core/search'

import type { Handler } from '../../context.js'
import {
  localDateTime,
  renderRecord,
  renderTable,
  statusStyle,
  stripControl,
} from '../../output.js'
import type { SpecOf } from '../../schema.js'
import { siteUrl } from '../../site.js'

/** The shape `--json` has always had: a subtask's `done` flag serves the desktop app, not the CLI. */
export type IssueData = Omit<IssueDetail, 'subtasks'> & {
  subtasks: { key: string; summary: string; status: string }[]
  descriptionMarkdown: string | null
  url: string
}

/** The issue as `issue get` and `issue create` return it. */
export function toIssueData(issue: IssueDetail, site: string): IssueData {
  const { description, subtasks, ...rest } = issue
  return {
    ...rest,
    description,
    descriptionMarkdown: description === null ? null : adfToMarkdown(description),
    subtasks: subtasks.map(({ key, summary, status }) => ({ key, summary, status })),
    url: `${site}/browse/${issue.key}`,
  }
}

/** `jm issue get <key>`: one issue with its description as ADF and as Markdown, its subtasks and its URL. */
export const get: Handler<SpecOf<'issue get'>, IssueData> = {
  async run({ key }, ctx) {
    const issue = await getIssue(ctx.http(), key, { signal: ctx.signal })
    return toIssueData(issue, await siteUrl())
  },

  render(issue, tty) {
    const rows: [string, string, ((value: string) => string)?][] = [
      ['Type', issue.issueType.name],
      ['Status', issue.status.name, (text) => statusStyle(tty, issue.status.category, text)],
    ]
    const optional: [string, string | null][] = [
      ['Assignee', issue.assignee?.displayName ?? null],
      ['Priority', issue.priority?.name ?? null],
      ['Customer', issue.customer?.value ?? null],
      ['Engagement', issue.engagement?.value ?? null],
      ['Sprint', issue.sprints.map((s) => s.name).join(', ') || null],
      ['Labels', issue.labels.join(', ') || null],
      ['Parent', issue.parentKey],
      ['Start date', issue.startDate],
      ['Due date', issue.dueDate],
    ]
    for (const [label, value] of optional) if (value !== null) rows.push([label, value])
    rows.push(['Updated', localDateTime(issue.updated)], ['URL', issue.url])

    const parts = [
      tty.style('bold', stripControl(`${issue.key}  ${issue.summary}`)),
      renderRecord(tty, rows),
    ]
    if (issue.subtasks.length > 0) {
      parts.push(
        tty.style('bold', 'Subtasks'),
        renderTable(
          tty,
          [{ header: 'KEY' }, { header: 'STATUS' }, { header: 'SUMMARY' }],
          issue.subtasks.map((s) => [s.key, s.status, s.summary]),
        ),
      )
    }
    parts.push(
      tty.style('bold', 'Description'),
      issue.descriptionMarkdown === null
        ? 'No description.'
        : stripControl(issue.descriptionMarkdown),
    )
    return parts.join('\n\n')
  },
}
