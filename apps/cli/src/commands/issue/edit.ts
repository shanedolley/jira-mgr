import { JiraMgrError } from '@jira-mgr/core'
import { getIssue } from '@jira-mgr/core/search'
import { assertInProject } from '@jira-mgr/core/state'
import { editIssue, type EditIssueInput } from '@jira-mgr/core/write'

import type { Handler } from '../../context.js'
import { readRichText } from '../../input.js'
import { resolveAssignee, resolveOption } from '../../resolve.js'
import type { SpecOf } from '../../schema.js'

/** The option each sent input came from, as `changed` names it. */
const OPTION_NAMES: Record<keyof EditIssueInput, string> = {
  summary: 'summary',
  description: 'description',
  assignee: 'assignee',
  priorityId: 'priority',
  startDate: 'start',
  dueDate: 'due',
  labels: 'label',
  addLabels: 'label',
  removeLabels: 'label',
  parentKey: 'parent',
  customerId: 'customer',
  engagementId: 'engagement',
  originalEstimate: 'estimate',
  timeRemainingHours: 'time-remaining',
  type: 'type',
}

const SWAPPABLE = ['Story', 'Task', 'Bug']

interface Edited {
  key: string
  changed: string[]
}

/** `jm issue edit <key>`: sends only the fields given, in one request. */
export const edit: Handler<SpecOf<'issue edit'>, Edited> = {
  async run(input, ctx) {
    await assertInProject(input.key)
    if (input.parent !== undefined) await assertInProject(input.parent)
    if (input.type !== undefined) {
      // Q23: a Story, Task or Bug can swap among the three; an Epic or Subtask cannot change type at all.
      const current = (await getIssue(ctx.http(), input.key, { signal: ctx.signal })).issueType.name
      if (!SWAPPABLE.includes(current)) {
        throw new JiraMgrError(
          'validation_failed',
          `${input.key} is ${/^[AEIOU]/i.test(current) ? 'an' : 'a'} ${current}. The type can change only among Story, Task and Bug.`,
        )
      }
    }
    const description = input.clearDescription
      ? null
      : await readRichText(ctx, {
          markdown: input.description,
          file: input.descriptionFile,
          adf: input.adf,
        })
    const changes: EditIssueInput = {
      summary: input.summary,
      description,
      // `none` arrives as null and clears the field.
      assignee:
        input.assignee === undefined || input.assignee === null
          ? input.assignee
          : await resolveAssignee(ctx, input.assignee),
      startDate: input.start,
      dueDate: input.due,
      timeRemainingHours: input.timeRemaining,
      priorityId:
        input.priority === undefined
          ? undefined
          : await resolveOption(ctx, 'priority', input.priority),
      labels: input.label.length > 0 ? input.label : undefined,
      addLabels: input.addLabel.length > 0 ? input.addLabel : undefined,
      removeLabels: input.removeLabel.length > 0 ? input.removeLabel : undefined,
      parentKey: input.parent,
      customerId:
        input.customer === undefined
          ? undefined
          : await resolveOption(ctx, 'customer', input.customer),
      engagementId:
        input.engagement === undefined
          ? undefined
          : await resolveOption(ctx, 'engagement', input.engagement),
      originalEstimate: input.estimate,
      type: input.type as 'Story' | 'Task' | 'Bug' | undefined,
    }
    await editIssue(ctx.http(), input.key, changes)
    const sent = (Object.keys(changes) as (keyof EditIssueInput)[])
      .filter((name) => changes[name] !== undefined)
      .map((name) => OPTION_NAMES[name])
    return { key: input.key, changed: [...new Set(sent)] }
  },

  render: ({ key, changed }) => `Updated ${key}: ${changed.join(', ')}`,
}
