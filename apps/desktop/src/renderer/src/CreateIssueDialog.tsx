import type { Issue } from '@jira-mgr/core'
import type { CustomerOption } from '@jira-mgr/core/hierarchy'
import { useEffect, useRef, useState, type SyntheticEvent, type KeyboardEvent } from 'react'

import {
  CREATE_TYPES,
  type CreatedIssue,
  type CreateType,
  type CurrentUser,
  type FieldChoice,
} from '../../shared/ipc'
import { Modal } from './Modal'
import { ParentPrompt } from './ParentPrompt'
import { Picker, type PickerOption } from './Picker'
import { Row } from './PropertyRow'
import {
  describeCreated,
  initialDraft,
  listWords,
  missingFields,
  nextDraft,
  toCreateArgs,
  typeRules,
  withType,
  type CreateDraft,
  type Notice,
} from './create'
import {
  NONE,
  STATE_LABELS,
  assigneeChoices,
  assigneeOptions,
  isLabel,
  parentChoices,
  parentMatch,
  projectLabels,
  recentAssignees,
  shownSprints,
  type ParentMatch,
  type Person,
} from './properties'
import { useCreateIssue, useFieldOptions, useSprints, useUsers } from './queries'
import { useDebounced } from './useDebounced'
import { TypeIcon } from './TypeIcon'

interface CreateIssueDialogProps {
  /** The issue `C` was pressed on, whose Epic, Customer and Engagement the form starts with. */
  selected: Issue | null
  /** The Customer header `C` was pressed on, when no issue is selected. */
  group: CustomerOption | null
  issues: readonly Issue[]
  me: CurrentUser | undefined
  onClose: () => void
  /** Called after each create. `more` is true when the modal stays open for the next one. */
  onCreated: (result: CreatedIssue, notice: Notice, more: boolean) => void
  returnFocus: () => void
}

const INPUT =
  'h-8 w-full min-w-0 rounded-md border border-line bg-canvas px-2 placeholder:text-muted disabled:opacity-60'

const fromChoices = (choices: FieldChoice[] | undefined): PickerOption[] =>
  (choices ?? []).map((c) => ({ id: c.id, label: c.name }))

/**
 * The create modal (Q33), opened by `C`. It starts as a Story under the Epic at or above the
 * selected issue, with that Epic's Customer and Engagement, and needs a summary, a Customer and an
 * Engagement. Create keeps the modal open with "Create more", clearing only the summary. Every
 * picker is the page's own `Picker`, and a parent whose Customer or Engagement differs asks the
 * Q16 question first. Nothing is sent until Jira's answer is needed: the new issue joins the
 * lists from the read-back.
 */
export function CreateIssueDialog({
  selected,
  group,
  issues,
  me,
  onClose,
  onCreated,
  returnFocus,
}: CreateIssueDialogProps) {
  const [draft, setDraft] = useState<CreateDraft>(() => initialDraft(selected, issues, group))
  const [more, setMore] = useState(false)
  const [last, setLast] = useState<Notice | null>(null)
  const [prompt, setPrompt] = useState<{ parent: Issue; match: ParentMatch } | null>(null)
  const create = useCreateIssue()
  const summaryRef = useRef<HTMLInputElement>(null)
  const parentTrigger = useRef<HTMLButtonElement>(null)
  const rules = typeRules(draft.type)

  const [parentQuery, setParentQuery] = useState('')
  const [customerOpen, setCustomerOpen] = useState(false)
  const customers = useFieldOptions('customer', customerOpen)
  const [engagementOpen, setEngagementOpen] = useState(false)
  const engagements = useFieldOptions('engagement', engagementOpen)
  const [assigneeOpen, setAssigneeOpen] = useState(false)
  const [assigneeQuery, setAssigneeQuery] = useState('')
  const found = useUsers(useDebounced(assigneeQuery.trim()), assigneeOpen)
  const [priorityOpen, setPriorityOpen] = useState(false)
  const priorities = useFieldOptions('priority', priorityOpen)
  const [sprintOpen, setSprintOpen] = useState(false)
  const [allSprints, setAllSprints] = useState(false)
  const sprints = useSprints(allSprints, sprintOpen)

  function edit(changes: Partial<CreateDraft>) {
    create.reset()
    setDraft((d) => ({ ...d, ...changes }))
  }

  const missing = missingFields(draft)
  const pending = create.isPending
  // The form is disabled while it sends, so the summary takes focus back once an answer enables it.
  useEffect(() => {
    if (create.isError || last !== null) summaryRef.current?.focus()
  }, [create.isError, last])
  // The prompt unmounts with its answer, so focus goes back to the Parent button that asked.
  const wasPrompting = useRef(false)
  useEffect(() => {
    if (prompt === null && wasPrompting.current) parentTrigger.current?.focus()
    wasPrompting.current = prompt !== null
  }, [prompt])

  function submit(event?: SyntheticEvent) {
    event?.preventDefault()
    const args = toCreateArgs(draft)
    if (args === null || pending) return
    create.mutate(args, {
      onSuccess: (result) => {
        const notice = describeCreated(draft, result)
        onCreated(result, notice, more)
        if (more) {
          setLast(notice)
          setDraft(nextDraft(draft))
        }
      },
    })
  }

  function onFormKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      submit()
    }
  }

  // Parent
  const parentList = parentChoices(
    { key: '', issueType: { subtask: draft.type === 'Subtask', hierarchyLevel: 0 } },
    issues,
    parentQuery,
  )
  const parentOptions: PickerOption[] = parentList.shown.map((p) => ({
    id: p.key,
    label: p.summary,
    leading: (
      <>
        <TypeIcon type={p.issueType} />
        <span className="shrink-0 font-mono text-xs text-muted">{p.key}</span>
      </>
    ),
  }))

  function chooseParent(key: string) {
    const target = issues.find((i) => i.key === key)
    if (target === undefined || key === draft.parent?.key) return
    if (draft.customer === null && draft.engagement === null) {
      // Nothing chosen yet, so nothing to disagree with: the parent's values start the form.
      edit({
        parent: target,
        customer:
          target.customer === null ? null : { id: target.customer.id, name: target.customer.value },
        engagement:
          target.engagement === null
            ? null
            : { id: target.engagement.id, name: target.engagement.value },
      })
      return
    }
    const match = parentMatch(
      {
        customer: draft.customer && { id: draft.customer.id, value: draft.customer.name },
        engagement: draft.engagement && { id: draft.engagement.id, value: draft.engagement.name },
      },
      target,
    )
    if (match.customer === null && match.engagement === null) edit({ parent: target })
    else setPrompt({ parent: target, match })
  }

  function moveUnder(withMatch: boolean) {
    if (prompt === null) return
    const { parent, match } = prompt
    setPrompt(null)
    edit({
      parent,
      ...(withMatch &&
        match.customer && {
          customer: { id: match.customer.id, name: match.customer.value },
        }),
      ...(withMatch &&
        match.engagement && {
          engagement: { id: match.engagement.id, name: match.engagement.value },
        }),
    })
  }

  // Assignee
  const meUser: Person | undefined =
    me === undefined
      ? undefined
      : { accountId: me.accountId, displayName: me.displayName, avatarUrl: null }
  const choices = assigneeChoices(
    meUser,
    recentAssignees(issues, me?.accountId ?? ''),
    found.data ?? [],
    assigneeQuery.trim(),
  )
  const people = new Map<string, Person>(
    [...choices.suggested, ...choices.others].map((p) => [p.accountId, p]),
  )

  function chooseAssignee(id: string) {
    if (id === NONE) edit({ assignee: null })
    else {
      const person = people.get(id)
      if (person !== undefined) edit({ assignee: person })
    }
  }

  // Labels
  const labelOptions: PickerOption[] = [
    ...new Set([...draft.labels, ...projectLabels(issues)]),
  ].map((label) => ({ id: label, label }))

  function toggleLabel(label: string) {
    edit({
      labels: draft.labels.includes(label)
        ? draft.labels.filter((l) => l !== label)
        : [...draft.labels, label],
    })
  }

  // Sprint
  const sprintList = shownSprints(sprints.data ?? [], allSprints)
  const sprintOptions: PickerOption[] = [
    { id: NONE, label: 'Backlog' },
    ...sprintList.map((s) => ({
      id: String(s.id),
      label: s.name,
      detail: STATE_LABELS[s.state],
      // Jira refuses a move into a closed sprint.
      disabled: s.state === 'closed',
    })),
  ]

  function chooseSprint(id: string) {
    edit({ sprint: id === NONE ? null : (sprintList.find((s) => String(s.id) === id) ?? null) })
  }

  const note = (
    query: { isPending: boolean; isError: boolean; error: Error | null },
    what: string,
  ) =>
    query.isPending
      ? `Loading ${what}`
      : query.isError
        ? `Could not load ${what}. ${query.error?.message ?? ''}`
        : undefined

  return (
    <Modal titleId="create-title" onClose={onClose} closable={!pending} returnFocus={returnFocus}>
      <form
        onSubmit={submit}
        onKeyDown={onFormKeyDown}
        className="flex flex-col"
        aria-describedby="create-needs"
      >
        <fieldset disabled={pending} className="contents">
          <div className="space-y-3 px-5 pb-3 pt-5">
            <h2 id="create-title" className="text-base font-semibold">
              New issue
            </h2>
            <input
              ref={summaryRef}
              autoFocus
              type="text"
              aria-label="Summary"
              placeholder="Summary"
              maxLength={255}
              autoComplete="off"
              value={draft.summary}
              onChange={(event) => {
                edit({ summary: event.target.value })
              }}
              className={`${INPUT} h-10 text-base`}
            />
          </div>
          <div className="space-y-1 border-y border-line px-3 py-3 [&_button[aria-haspopup=listbox]]:border [&_button[aria-haspopup=listbox]]:border-line">
            <Row name="Type">
              <Picker
                label="Type"
                valueText={draft.type}
                options={CREATE_TYPES.map((t) => ({ id: t, label: t }))}
                selected={[draft.type]}
                onSelect={(id) => {
                  setDraft((d) => withType(d, id as CreateType, selected, issues))
                }}
              />
            </Row>
            {rules.parent && (
              <Row name="Parent">
                <Picker
                  label="Parent"
                  triggerRef={parentTrigger}
                  valueText={
                    draft.parent === null ? 'None' : `${draft.parent.key} ${draft.parent.summary}`
                  }
                  options={parentOptions}
                  selected={draft.parent === null ? [] : [draft.parent.key]}
                  searchable
                  onQuery={setParentQuery}
                  onSelect={chooseParent}
                  note={
                    parentList.total > parentList.shown.length
                      ? `Showing ${String(parentList.shown.length)} of ${String(parentList.total)}. Keep typing to narrow.`
                      : undefined
                  }
                />
              </Row>
            )}
            <Row name="Customer">
              <Picker
                label="Customer"
                valueText={draft.customer?.name ?? 'None'}
                options={fromChoices(customers.data)}
                selected={draft.customer === null ? [] : [draft.customer.id]}
                searchable
                onSelect={(id) => {
                  const picked = customers.data?.find((c) => c.id === id)
                  if (picked !== undefined) edit({ customer: picked })
                }}
                onOpenChange={setCustomerOpen}
                note={note(customers, 'Customers')}
              />
            </Row>
            <Row name="Engagement">
              <Picker
                label="Engagement"
                valueText={draft.engagement?.name ?? 'None'}
                options={fromChoices(engagements.data)}
                selected={draft.engagement === null ? [] : [draft.engagement.id]}
                searchable
                onSelect={(id) => {
                  const picked = engagements.data?.find((c) => c.id === id)
                  if (picked !== undefined) edit({ engagement: picked })
                }}
                onOpenChange={setEngagementOpen}
                note={note(engagements, 'Engagements')}
              />
            </Row>
            <Row name="Assignee">
              <Picker
                label="Assignee"
                valueText={draft.assignee?.displayName ?? 'Unassigned'}
                options={assigneeOptions(choices, assigneeQuery, me?.accountId)}
                selected={[draft.assignee?.accountId ?? NONE]}
                searchable
                onQuery={setAssigneeQuery}
                onSelect={chooseAssignee}
                onOpenChange={setAssigneeOpen}
                note={
                  found.isError
                    ? `Could not search people. ${found.error.message}`
                    : found.isFetching
                      ? 'Searching'
                      : undefined
                }
              />
            </Row>
            <Row name="Priority">
              <Picker
                label="Priority"
                valueText={draft.priority?.name ?? 'None'}
                options={fromChoices(priorities.data)}
                selected={draft.priority === null ? [] : [draft.priority.id]}
                onSelect={(id) => {
                  const picked = priorities.data?.find((c) => c.id === id)
                  if (picked !== undefined) edit({ priority: picked })
                }}
                onOpenChange={setPriorityOpen}
                note={note(priorities, 'priorities')}
              />
            </Row>
            <Row name="Labels">
              <Picker
                label="Labels"
                valueText={draft.labels.length === 0 ? 'None' : draft.labels.join(', ')}
                options={labelOptions}
                selected={draft.labels}
                multiple
                searchable
                create={{ valid: isLabel, label: (text) => `Create "${text}"` }}
                onSelect={toggleLabel}
                onCreate={(text) => {
                  if (!draft.labels.includes(text)) toggleLabel(text)
                }}
              />
            </Row>
            {rules.sprint && (
              <Row name="Sprint">
                <Picker
                  label="Sprint"
                  valueText={draft.sprint?.name ?? 'Backlog'}
                  options={sprintOptions}
                  selected={[draft.sprint === null ? NONE : String(draft.sprint.id)]}
                  onSelect={chooseSprint}
                  onOpenChange={setSprintOpen}
                  note={note(sprints, 'sprints')}
                  footer={
                    <button
                      type="button"
                      aria-pressed={allSprints}
                      onClick={() => {
                        setAllSprints(!allSprints)
                      }}
                      className="mt-1 flex h-8 w-full items-center rounded px-2 text-left text-xs hover:bg-hover"
                    >
                      {allSprints ? 'Show fewer sprints' : 'Show all sprints'}
                    </button>
                  }
                />
              </Row>
            )}
            {rules.estimates && (
              <Row name="Estimate">
                <input
                  type="text"
                  aria-label="Original estimate"
                  placeholder="2h 30m"
                  autoComplete="off"
                  value={draft.estimate}
                  aria-invalid={missing.some((m) => m.startsWith('an estimate')) || undefined}
                  onChange={(event) => {
                    edit({ estimate: event.target.value })
                  }}
                  className="h-7 w-full min-w-0 rounded-md border border-line bg-transparent px-2 hover:bg-hover focus:bg-canvas aria-invalid:border-danger"
                />
              </Row>
            )}
          </div>
          <div className="space-y-2 px-5 py-3">
            {last !== null && (
              <p role="status" className="text-xs">
                <span className="font-medium">{last.title}.</span>{' '}
                <span className="text-muted">{last.notes.join(' ')}</span>
              </p>
            )}
            {create.isError && (
              <p role="alert" className="text-xs text-danger">
                Could not create the issue. {create.error.message}
              </p>
            )}
            <p id="create-needs" className="text-xs text-muted">
              {missing.length === 0 ? 'Ready to create.' : `Add ${listWords(missing)} to create.`}
            </p>
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={more}
                  onChange={(event) => {
                    setMore(event.target.checked)
                  }}
                />
                Create more
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-line px-3 py-1 hover:bg-hover"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={missing.length > 0}
                  className="rounded-md bg-accent px-3 py-1 font-medium text-accent-ink disabled:opacity-50"
                >
                  {pending ? 'Creating' : 'Create issue'}
                </button>
              </div>
            </div>
          </div>
        </fieldset>
      </form>
      {prompt !== null && (
        <ParentPrompt
          subject="this issue"
          parent={prompt.parent}
          match={prompt.match}
          onChoose={moveUnder}
          onCancel={() => {
            setPrompt(null)
          }}
        />
      )}
    </Modal>
  )
}
