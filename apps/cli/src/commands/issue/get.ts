import { JiraMgrError } from '@jira-mgr/core'
import { adfToMarkdown } from '@jira-mgr/core/adf'
import { parseSiteUrl } from '@jira-mgr/core/auth'
import { getIssue, type IssueDetail } from '@jira-mgr/core/search'
import { readSettings } from '@jira-mgr/core/state'

import type { Handler } from '../../context.js'
import {
  localDateTime,
  renderRecord,
  renderTable,
  statusStyle,
  stripControl,
} from '../../output.js'
import type { SpecOf } from '../../schema.js'

type IssueData = IssueDetail & { descriptionMarkdown: string | null; url: string }

/** `jm issue get <key>`: one issue with its description as ADF and as Markdown, its subtasks and its URL. */
export const get: Handler<SpecOf<'issue get'>, IssueData> = {
  async run({ key }, ctx) {
    const issue = await getIssue(ctx.http(), key, { signal: ctx.signal })
    const siteUrl = parseSiteUrl((await readSettings()).siteUrl ?? '')
    if (siteUrl === null) {
      throw new JiraMgrError(
        'validation_failed',
        'The site URL in settings is not an https://<name>.atlassian.net site. Run `jm auth login` again.',
      )
    }
    const { description, subtasks, ...rest } = issue
    return {
      ...rest,
      description,
      descriptionMarkdown: description === null ? null : adfToMarkdown(description),
      subtasks,
      url: `${siteUrl}/browse/${issue.key}`,
    }
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
