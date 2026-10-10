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
import { AdfEditor, type AdfEditorHandle } from './AdfEditor'
import { formatSize } from './activity'
import { attachFiles } from './attach'
import { Avatar, withAvatars } from './Avatar'
import { Failure, Reason } from './Failure'
import { LabelDot, PriorityBars } from './Glyphs'
import { Modal } from './Modal'
import { ParentPrompt } from './ParentPrompt'
import { Picker, type PickerOption } from './Picker'
import {
  describeCreated,
  descriptionOf,
  initialDraft,
  listWords,
  firstMissing,
  missingKeys,
  missingFields,
  nextDraft,
  toCreateArgs,
  typeRules,
  withType,
  withUploadFailures,
  type CreateDraft,
  type FailedFile,
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
import { useAttachFile } from './activityQueries'
import { useCreateIssue, useFieldOptions, useSprints, useUsers } from './queries'
import { useDebounced } from './useDebounced'
import { TypeIcon } from './TypeIcon'

interface CreateIssueDialogProps {
  /** The issue `C` was pressed on, whose Epic, Customer and Engagement the form starts with. */
  selected: Issue | null
  /** The Customer header `C` was pressed on, when no issue is selected. */
  group: CustomerOption | null
  /** The type the form starts as. A Story when absent. */
  type?: CreateType
  issues: readonly Issue[]
  me: CurrentUser | undefined
  onClose: () => void
  /** Called after each create. `more` is true when the modal stays open for the next one. */
  onCreated: (
    result: CreatedIssue,
    notice: Notice,
    more: boolean,
    draft: CreateDraft,
    /** A chosen file did not attach, so the notice names it and must reach a toast even when `more` keeps the modal open. */
    failedFiles: boolean,
  ) => void
  returnFocus: () => void
}

const INPUT =
  'h-8 w-full min-w-0 rounded-md border border-field-border bg-canvas px-2 placeholder:text-muted disabled:opacity-60'

/** What a required chip reads while nothing is chosen. */
const REQUIRED = 'Required'

/** A chip's property name, muted before its value. */
const ChipName = ({ children }: { children: string }) => (
  <span className="shrink-0 text-muted">{children}</span>
)

const fromChoices = (choices: FieldChoice[] | undefined): PickerOption[] =>
  (choices ?? []).map((c) => ({ id: c.id, label: c.name }))

/**
 * The create modal (Q33), opened by `C`. It starts as a Story under the Epic at or above the
 * selected issue, with that Epic's Customer and Engagement, and needs a summary, a Customer and an
 * Engagement. It also takes a description and files: the description goes in the create request,
 * and the files attach once the issue exists, where a failed one is named in the notice and leaves
 * the issue in place. Create keeps the modal open with "Create more", clearing the summary, the
 * description and the files. Every
 * picker is the page's own `Picker`, and a parent whose Customer or Engagement differs asks the
 * Q16 question first. Nothing is sent until Jira's answer is needed: the new issue joins the
 * lists from the read-back.
 */
export function CreateIssueDialog({
  selected,
  group,
  type,
  issues,
  me,
  onClose,
  onCreated,
  returnFocus,
}: CreateIssueDialogProps) {
  const [draft, setDraft] = useState<CreateDraft>(() => initialDraft(selected, issues, group, type))
  const [more, setMore] = useState(false)
  const [last, setLast] = useState<Notice | null>(null)
  const [prompt, setPrompt] = useState<{ parent: Issue; match: ParentMatch } | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [attaching, setAttaching] = useState(false)
  /** The description editor holds more than its one empty paragraph. */
  const [touched, setTouched] = useState(false)
  const create = useCreateIssue()
  const attach = useAttachFile()
  const descriptionRef = useRef<AdfEditorHandle>(null)
  const filePicker = useRef<HTMLInputElement>(null)
  const summaryRef = useRef<HTMLInputElement>(null)
  const parentTrigger = useRef<HTMLButtonElement>(null)
  const assigneeTrigger = useRef<HTMLButtonElement>(null)
  const customerTrigger = useRef<HTMLButtonElement>(null)
  const engagementTrigger = useRef<HTMLButtonElement>(null)
  const estimateRef = useRef<HTMLInputElement>(null)
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
  const estimateBad = missingKeys(draft).includes('estimate')
  const pending = create.isPending || attaching
  // Not `autoFocus`: the modal opens after its content mounts, and opening takes focus to the first control.
  useEffect(() => {
    summaryRef.current?.focus()
  }, [])
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
    if (pending) return
    const args = toCreateArgs(draft)
    if (args === null) {
      // Cmd+Enter on an unready form: the Create button is disabled, so the key says where to go.
      const target = {
        summary: summaryRef,
        customer: customerTrigger,
        engagement: engagementTrigger,
        parent: parentTrigger,
        estimate: estimateRef,
      }
      const first = firstMissing(draft)
      if (first !== null) target[first].current?.focus()
      return
    }
    create.mutate(args, {
      onSuccess: (result) => {
        void finish(result, draft, files)
      },
    })
  }

  /** Attaches the files to the new issue, then tells the user and either closes or clears the form. */
  async function finish(result: CreatedIssue, sent: CreateDraft, chosen: readonly File[]) {
    let notice = describeCreated(sent, result)
    let failedFiles = false
    if (chosen.length > 0) {
      const failed: FailedFile[] = []
      setAttaching(true)
      await attachFiles(chosen, {
        send: (file) => attach.mutateAsync({ key: result.key, ...file }),
        start: () => undefined,
        finish: () => undefined,
        fail: ({ notes }, name) => failed.push({ name, reason: notes.join(' ') }),
      })
      setAttaching(false)
      notice = withUploadFailures(notice, result.key, failed)
      failedFiles = failed.length > 0
    }
    onCreated(result, notice, more, sent, failedFiles)
    if (more) {
      setLast(notice)
      setDraft(nextDraft(sent))
      setFiles([])
      descriptionRef.current?.reset(null)
      setTouched(false)
    }
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
      : { accountId: me.accountId, displayName: me.displayName, avatarUrl: me.avatarUrl }
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
  ].map((label) => ({ id: label, label, leading: <LabelDot /> }))

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
    query.isPending ? (
      `Loading ${what}`
    ) : query.error !== null ? (
      <Reason lead={`Could not load ${what}.`} error={query.error} />
    ) : undefined

  return (
    <Modal
      titleId="create-title"
      onClose={onClose}
      closable={!pending}
      returnFocus={returnFocus}
      className="w-[min(42rem,calc(100vw-2rem))]"
    >
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
            <div className="flex gap-2">
              <Picker
                label="Type"
                variant="icon"
                valueText={draft.type}
                leading={<TypeIcon type={{ name: draft.type }} decorative />}
                options={CREATE_TYPES.map((t) => ({
                  id: t,
                  label: t,
                  leading: <TypeIcon type={{ name: t }} decorative />,
                }))}
                selected={[draft.type]}
                onSelect={(id) => {
                  setDraft((d) => withType(d, id as CreateType, selected, issues))
                }}
              />
              <input
                ref={summaryRef}
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
            {/* A contenteditable ignores `<fieldset disabled>`, so `inert` locks the editor while it sends. */}
            <div
              inert={pending}
              className={`relative max-h-48 overflow-y-auto rounded-md border border-field-border bg-canvas px-2 py-1.5 focus-within:outline-2 focus-within:outline-accent [&_.ProseMirror]:min-h-16 ${pending ? 'opacity-60' : ''}`}
            >
              <AdfEditor
                ref={descriptionRef}
                embedded
                value={null}
                issueKey=""
                label="Description"
                autoFocus={false}
                editing
                onSave={() => undefined}
                // Esc closes the dialog, as it does from the summary; the editor would otherwise keep the key.
                onCancel={() => {
                  if (!pending) onClose()
                }}
                onChange={(doc) => {
                  edit({ description: descriptionOf(doc) })
                  // Not `draft.description`: a blank line or an empty bullet shows, and sends nothing.
                  setTouched(
                    doc.content.length > 1 ||
                      doc.content[0]?.type !== 'paragraph' ||
                      (doc.content[0].content?.length ?? 0) > 0,
                  )
                }}
                onEditRequest={() => undefined}
                onUnsupported={() => undefined}
              />
              {!touched && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-2 top-1.5 text-muted"
                >
                  Add a description
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 border-y border-line px-5 py-3">
            {rules.parent && (
              <Picker
                label="Parent"
                variant={draft.type === 'Subtask' ? 'filled' : 'chip'}
                leading={<ChipName>Parent</ChipName>}
                triggerRef={parentTrigger}
                valueText={
                  draft.parent === null
                    ? draft.type === 'Subtask'
                      ? REQUIRED
                      : 'None'
                    : `${draft.parent.key} ${draft.parent.summary}`
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
            )}
            <Picker
              label="Customer"
              variant="filled"
              leading={<ChipName>Customer</ChipName>}
              triggerRef={customerTrigger}
              valueText={draft.customer?.name ?? REQUIRED}
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
            <Picker
              label="Engagement"
              variant="filled"
              leading={<ChipName>Engagement</ChipName>}
              triggerRef={engagementTrigger}
              valueText={draft.engagement?.name ?? REQUIRED}
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
            {rules.estimates && (
              <label
                className={`flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs focus-within:outline-2 focus-within:outline-accent ${estimateBad ? 'border-danger' : 'border-field-border'}`}
              >
                <ChipName>Estimate</ChipName>
                <input
                  ref={estimateRef}
                  type="text"
                  aria-label="Original estimate"
                  placeholder="2h 30m"
                  autoComplete="off"
                  value={draft.estimate}
                  aria-invalid={estimateBad || undefined}
                  onChange={(event) => {
                    edit({ estimate: event.target.value })
                  }}
                  className="field-sizing-content min-w-12 max-w-40 bg-transparent focus-visible:outline-none"
                />
              </label>
            )}
            <Picker
              label="Assignee"
              variant="chip"
              triggerRef={assigneeTrigger}
              valueText={draft.assignee?.displayName ?? 'Unassigned'}
              leading={
                <>
                  <ChipName>Assignee</ChipName>
                  <Avatar person={draft.assignee} />
                </>
              }
              options={withAvatars(assigneeOptions(choices, assigneeQuery, me?.accountId), people)}
              selected={[draft.assignee?.accountId ?? NONE]}
              searchable
              onQuery={setAssigneeQuery}
              onSelect={chooseAssignee}
              onOpenChange={setAssigneeOpen}
              note={
                found.isError ? (
                  <Reason lead="Could not search people." error={found.error} />
                ) : found.isFetching ? (
                  'Searching'
                ) : undefined
              }
            />
            {meUser !== undefined && draft.assignee?.accountId !== meUser.accountId && (
              <button
                type="button"
                aria-label="Assign to me"
                onClick={() => {
                  edit({ assignee: meUser })
                  // This button leaves the page once the assignee is me, so focus moves first.
                  assigneeTrigger.current?.focus()
                }}
                className="h-7 rounded-full px-2 text-xs text-muted hover:bg-hover"
              >
                +me
              </button>
            )}
            <Picker
              label="Priority"
              variant="chip"
              leading={<ChipName>Priority</ChipName>}
              valueText={draft.priority?.name ?? 'None'}
              options={fromChoices(priorities.data).map((o) => ({
                ...o,
                leading: <PriorityBars name={o.label} />,
              }))}
              selected={draft.priority === null ? [] : [draft.priority.id]}
              onSelect={(id) => {
                const picked = priorities.data?.find((c) => c.id === id)
                if (picked !== undefined) edit({ priority: picked })
              }}
              onOpenChange={setPriorityOpen}
              note={note(priorities, 'priorities')}
            />
            <Picker
              label="Labels"
              variant="chip"
              leading={<ChipName>Labels</ChipName>}
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
            {rules.sprint && (
              <Picker
                label="Sprint"
                variant="chip"
                leading={<ChipName>Sprint</ChipName>}
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
              <Failure
                lead="Could not create the issue."
                error={create.error}
                className="text-xs text-danger"
              />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  filePicker.current?.click()
                }}
                className="h-7 rounded-full border border-field-border px-2.5 text-xs hover:bg-hover"
              >
                Attach files
              </button>
              <input
                ref={filePicker}
                type="file"
                multiple
                hidden
                aria-label="Choose files to attach"
                onChange={(event) => {
                  const chosen = Array.from(event.target.files ?? [])
                  setFiles((held) => [...held, ...chosen])
                  // Chosen again, the same file must still raise a change.
                  event.target.value = ''
                }}
              />
              {files.map((file, index) => (
                <span
                  key={`${file.name}-${String(index)}`}
                  className="flex h-7 max-w-full items-center gap-1.5 rounded-full border border-field-border pl-2.5 pr-1 text-xs"
                >
                  <span className="min-w-0 truncate">{file.name}</span>
                  <span className="shrink-0 text-muted">{formatSize(file.size)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => {
                      setFiles((held) => held.filter((_, at) => at !== index))
                    }}
                    className="flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-hover"
                  >
                    <span aria-hidden>×</span>
                  </button>
                </span>
              ))}
            </div>
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
                  {attaching ? 'Attaching' : pending ? 'Creating' : 'Create issue'}
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
