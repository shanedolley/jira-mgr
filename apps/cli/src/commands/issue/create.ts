import { JiraMgrError } from '@jira-mgr/core'
import { assertInProject } from '@jira-mgr/core/state'
import { createIssue } from '@jira-mgr/core/write'

import type { Handler } from '../../context.js'
import { readRichText } from '../../input.js'
import { resolveAssignee, resolveOption } from '../../resolve.js'
import { stripControl } from '../../output.js'
import type { SpecOf } from '../../schema.js'
import { siteUrl } from '../../site.js'
import { toIssueData, type IssueData } from './get.js'

/** `jm issue create`: resolves the names, makes one create request, then returns the issue as `issue get` does. */
export const create: Handler<SpecOf<'issue create'>, IssueData> = {
  async run(input, ctx) {
    // Everything that can refuse runs before the write, so a refusal leaves nothing half done.
    if (input.type === 'Subtask' && input.parent === undefined) {
      throw new JiraMgrError('validation_failed', 'A Subtask needs --parent.')
    }
    if (input.parent !== undefined) await assertInProject(input.parent)
    const site = await siteUrl()
    const description = await readRichText(ctx, {
      markdown: input.description,
      file: input.descriptionFile,
      adf: input.adf,
    })
    const customerId = await resolveOption(ctx, 'customer', input.customer)
    const engagementId = await resolveOption(ctx, 'engagement', input.engagement)
    const priorityId =
      input.priority === undefined
        ? undefined
        : await resolveOption(ctx, 'priority', input.priority)
    const assignee =
      input.assignee === undefined ? undefined : await resolveAssignee(ctx, input.assignee)

    const issue = await createIssue(
      ctx.http(),
      {
        type: input.type as 'Epic' | 'Story' | 'Task' | 'Bug' | 'Subtask',
        summary: input.summary,
        customerId,
        engagementId,
        parentKey: input.parent,
        description,
        assignee,
        priorityId,
        labels: input.label.length > 0 ? input.label : undefined,
        startDate: input.start,
        dueDate: input.due,
        originalEstimate: input.estimate,
        timeRemainingHours: input.timeRemaining,
      },
      { signal: ctx.signal },
    )
    return toIssueData(issue, site)
  },

  render: ({ key, url }) => `Created ${stripControl(key)}  ${stripControl(url)}`,
}
