import type { Issue } from '@jira-mgr/core'
import type { CustomerOption } from '@jira-mgr/core/hierarchy'
import type { EditorDoc } from '@jira-mgr/core/adf'
import { useQueryClient } from '@tanstack/react-query'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type SyntheticEvent,
  type KeyboardEvent,
} from 'react'

import {
  CREATE_TYPES,
  IMAGE_TYPES,
  type CreatedIssue,
  type CreateType,
  type CurrentUser,
  type FieldChoice,
} from '../../shared/ipc'
import { AdfEditor, type AdfEditorHandle } from './AdfEditor'
import { formatSize } from './activity'
import { attachFiles } from './attach'
import { Avatar, withAvatars } from './Avatar'
import { DropZone, isClaimed } from './DropZone'
import { Failure, Reason } from './Failure'
import { FileDragContext, useFileDrag } from './fileDrag'
import { LabelDot, PriorityBars } from './Glyphs'
import { Icon, TRASH } from './Icon'
import { Modal } from './Modal'
import { ParentPrompt } from './ParentPrompt'
import { Picker, type PickerOption } from './Picker'
import {
  describeCreated,
  descriptionOf,
  fillImages,
  pastedImages,
  copiedDescription,
  copyDraft,
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
  type CreateCopy,
  type CreateDraft,
  type FailedFile,
  type Notice,
} from './create'
import {
  NONE,
  assigneeChoices,
  assigneeOptions,
  isLabel,
  parentChoices,
  parentMatch,
  projectLabels,
  recentAssignees,
  shownSprints,
  sprintDetail,
  type ParentMatch,
  type Person,
} from './properties'
import { useAttachFile } from './activityQueries'
import { embedPasted, imageNotes } from './createImages'
import {
  conflictOf,
  saveCreatedDescription,
  useCreateIssue,
  useFieldOptions,
  useSprints,
  useUsers,
} from './queries'
import { useToday } from './today'
import { commitUpload, getUpload, removeUploadsOf, STAGED_KEY } from './uploads'
import { useDebounced } from './useDebounced'
import { TypeIcon } from './TypeIcon'

interface CreateIssueDialogProps {
  /** The issue `C` was pressed on, whose Epic, Customer and Engagement the form starts with. */
  selected: Issue | null
  /** The Customer header `C` was pressed on, when no issue is selected. */
  group: CustomerOption | null
  /** The type the form starts as. A Story when absent. */
  type?: CreateType
  /** Starts the form as a copy of this issue, which `selected`, `group` and `type` then leave alone. */
  copy?: CreateCopy
  issues: readonly Issue[]
  me: CurrentUser | undefined
  onClose: () => void
  /**
   * Called the moment the issue exists, before any image or file uploads. `notice` is what the
   * form compared with Jira's first read, which a later read of the automation's changes is
   * measured against, however long the uploads take.
   */
  onCreating: (result: CreatedIssue, notice: Notice, draft: CreateDraft) => void
  /** Called after each create. `more` is true when the modal stays open for the next one. */
  onCreated: (
    result: CreatedIssue,
    notice: Notice,
    more: boolean,
    /** A chosen file did not attach, so the notice names it and must reach a toast even when `more` keeps the modal open. */
    failedFiles: boolean,
  ) => void
  returnFocus: () => void
}

const INPUT =
  'h-8 w-full min-w-0 rounded-md border border-field-border bg-canvas px-2 placeholder:text-muted disabled:opacity-60'

/** What a required chip reads while nothing is chosen. */
const REQUIRED = 'Required'

type DateField = 'startDate' | 'dueDate'
const DATE_FIELDS: readonly DateField[] = ['startDate', 'dueDate']
const DATE_NAMES: Record<DateField, string> = { startDate: 'Start date', dueDate: 'Due date' }

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
 * the issue in place. A file chosen with Attach files or dropped on the dialog stages as a file to
 * attach. An image pasted into the description, or dropped on it, stages too, with a preview in
 * place: once the issue exists it uploads, and the description is written again with the image in
 * it. A failed upload or write is named in the notice and leaves the issue and its text in place.
 * Create keeps the modal open with "Create more", clearing the summary, the description and the
 * files. Every picker is the page's own `Picker`, and a parent whose Customer or Engagement differs asks the
 * Q16 question first. Nothing is sent until Jira's answer is needed: the new issue joins the
 * lists from the read-back.
 */
export function CreateIssueDialog({
  selected,
  group,
  type,
  copy,
  issues,
  me,
  onClose,
  onCreating,
  onCreated,
  returnFocus,
}: CreateIssueDialogProps) {
  const meUser = useMemo<Person | undefined>(
    () =>
      me === undefined
        ? undefined
        : { accountId: me.accountId, displayName: me.displayName, avatarUrl: me.avatarUrl },
    [me],
  )
  // A copy's description, which the editor starts with and the draft holds until the user edits it.
  const [copied] = useState(() => (copy === undefined ? null : copiedDescription(copy.description)))
  const [draft, setDraft] = useState<CreateDraft>(() =>
    copy === undefined
      ? initialDraft(selected, issues, group, type, meUser ?? null)
      : copyDraft(copy.source, copied, issues, meUser ?? null),
  )
  /** The user picked an assignee, so a current user that loads later must not replace it. */
  const assigneeChosen = useRef(false)
  const [more, setMore] = useState(false)
  const [last, setLast] = useState<Notice | null>(null)
  const [prompt, setPrompt] = useState<{ parent: Issue; match: ParentMatch } | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [attaching, setAttaching] = useState(false)
  /** The description editor holds more than its one empty paragraph. */
  const [touched, setTouched] = useState(copied !== null)
  const create = useCreateIssue()
  const attach = useAttachFile()
  const client = useQueryClient()
  const dragging = useFileDrag()
  const descriptionRef = useRef<AdfEditorHandle>(null)
  const filePicker = useRef<HTMLInputElement>(null)
  const summaryRef = useRef<HTMLInputElement>(null)
  const parentTrigger = useRef<HTMLButtonElement>(null)
  const assigneeTrigger = useRef<HTMLButtonElement>(null)
  const customerTrigger = useRef<HTMLButtonElement>(null)
  const engagementTrigger = useRef<HTMLButtonElement>(null)
  const estimateRef = useRef<HTMLInputElement>(null)
  const dateRefs = useRef<Partial<Record<DateField, HTMLInputElement | null>>>({})
  // A date input half typed ("10/yyyy") reports "" like an empty one, so the draft cannot tell them apart.
  const [halfDates, setHalfDates] = useState<ReadonlySet<DateField>>(new Set())
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

  // Images still staged when the dialog closes would keep their previews for the session.
  useEffect(
    () => () => {
      removeUploadsOf(STAGED_KEY)
    },
    [],
  )

  function edit(changes: Partial<CreateDraft>) {
    create.reset()
    setDraft((d) => ({ ...d, ...changes }))
  }

  // The current user may load after the dialog opens; the draft takes it unless the user chose.
  useEffect(() => {
    if (meUser === undefined || assigneeChosen.current) return
    setDraft((d) => (d.assignee?.accountId === meUser.accountId ? d : { ...d, assignee: meUser }))
  }, [meUser])

  const halfTyped = DATE_FIELDS.filter((field) => halfDates.has(field))
  const missing = [
    ...missingFields(draft),
    ...halfTyped.map((field) => `a complete ${DATE_NAMES[field]}`),
  ]
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

  function setDateHalf(field: DateField, half: boolean) {
    setHalfDates((held) => {
      if (held.has(field) === half) return held
      const next = new Set(held)
      if (half) next.add(field)
      else next.delete(field)
      return next
    })
  }

  function submit(event?: SyntheticEvent) {
    event?.preventDefault()
    if (pending) return
    // The browser fires no input event while a date is typed in part, so ask the input itself.
    const half = DATE_FIELDS.find((field) => dateRefs.current[field]?.validity.badInput)
    if (half !== undefined) {
      setDateHalf(half, true)
      dateRefs.current[half]?.focus()
      return
    }
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
    // Read now: the images the description holds are still placeholders, which the editor keeps.
    const doc = descriptionRef.current?.json() ?? null
    create.mutate(args, {
      onSuccess: (result) => {
        const notice = describeCreated(draft, result)
        onCreating(result, notice, draft)
        void finish(result, draft, files, doc, notice)
      },
    })
  }

  /** Stages files to attach once the issue exists. A drop while the create is in flight is ignored. */
  function stage(incoming: File[]) {
    if (pending || incoming.length === 0) return
    setFiles((held) => [...held, ...incoming])
  }

  const isImage = (file: File) => (IMAGE_TYPES as readonly string[]).includes(file.type)

  /** Files dropped on the description: images go into it, anything else stages as an attachment. */
  function dropOnDescription(dropped: File[], handled: boolean) {
    stage(dropped.filter((file) => !isImage(file)))
    // Images dropped on the editor are already in it; only the rest was left over.
    const images = dropped.filter(isImage)
    if (!handled && !pending && images.length > 0) descriptionRef.current?.addImages(images)
  }

  /** A file dropped where no zone took it, such as the title: it stages like one chosen with Attach files. */
  function onDrop(event: DragEvent<HTMLElement>) {
    if (isClaimed(event.nativeEvent) || !event.dataTransfer.types.includes('Files')) return
    stage(Array.from(event.dataTransfer.files))
  }

  /**
   * Uploads the pasted images and writes them into the description, attaches the files, then tells
   * the user and either closes or clears the form. The issue exists, so no step here undoes it.
   */
  async function finish(
    result: CreatedIssue,
    sent: CreateDraft,
    chosen: readonly File[],
    doc: EditorDoc | null,
    first: Notice,
  ) {
    let notice = first
    let failedFiles = false
    const pasted = doc === null ? [] : pastedImages(doc)
    if (chosen.length > 0 || pasted.length > 0) setAttaching(true)
    try {
      if (doc !== null && pasted.length > 0) {
        const embedded = await embedPasted(
          doc,
          // Jira's copy of the description, which may differ from what was sent, such as in ids it adds.
          result.issue?.description ?? sent.description,
          {
            upload: async (id) => {
              const state = await commitUpload(id, result.key)
              if (state.status === 'done') return { node: state.node }
              return { failed: state.status === 'failed' ? state.message : 'It did not finish.' }
            },
            name: (id) => getUpload(id)?.filename ?? 'The pasted image',
            save: async (description, base) => {
              try {
                await saveCreatedDescription(client, { key: result.key, description, base })
                return 'saved'
              } catch (error) {
                if (conflictOf(error) !== null) return 'changed'
                throw error
              }
            },
          },
        )
        const notes = imageNotes(result.key, embedded)
        if (notes.length > 0) {
          notice = { ...notice, notes: [...notice.notes, ...notes], warned: true }
          failedFiles = true
        }
      }
      if (chosen.length > 0) {
        const failed: FailedFile[] = []
        await attachFiles(chosen, {
          send: (file) => attach.mutateAsync({ key: result.key, ...file }),
          start: () => undefined,
          finish: () => undefined,
          fail: ({ notes }, name) => failed.push({ name, reason: notes.join(' ') }),
        })
        notice = withUploadFailures(notice, result.key, failed)
        failedFiles ||= failed.length > 0
      }
    } catch (error) {
      // The issue exists, so a step that threw must still end the create: a second Create would
      // make a duplicate.
      const reason = error instanceof Error ? error.message : String(error)
      notice = {
        ...notice,
        notes: [...notice.notes, `Something went wrong after ${result.key} was created. ${reason}`],
        warned: true,
      }
      failedFiles = true
    } finally {
      // Not before the files attach: the placeholders are still in the editor, and one whose
      // entry is gone shows "The upload was lost." The editor is cleared first, so no placeholder
      // outlives its entry, even for a moment. The sweep also takes an image deleted from the text.
      if (more) descriptionRef.current?.reset(null)
      removeUploadsOf(STAGED_KEY)
      setAttaching(false)
    }
    onCreated(result, notice, more, failedFiles)
    if (more) {
      setLast(notice)
      setDraft(nextDraft(sent))
      setFiles([])
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
    assigneeChosen.current = true
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
  const today = useToday()
  const sprintList = shownSprints(sprints.data ?? [], allSprints)
  const sprintOptions: PickerOption[] = [
    { id: NONE, label: 'Backlog' },
    ...sprintList.map((s) => ({
      id: String(s.id),
      label: s.name,
      detail: sprintDetail(s, today),
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
      <FileDragContext value={dragging}>
        <form
          onSubmit={submit}
          onKeyDown={onFormKeyDown}
          onDrop={onDrop}
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
              <DropZone label="Add images into description" onFiles={dropOnDescription}>
                {/* A contenteditable ignores `<fieldset disabled>`, so `inert` locks the editor while it sends. */}
                <div
                  inert={pending}
                  className={`relative max-h-48 overflow-y-auto rounded-md border border-field-border bg-canvas px-2 py-1.5 focus-within:outline-2 focus-within:outline-accent [&_.ProseMirror]:min-h-16 ${pending ? 'opacity-60' : ''}`}
                >
                  <AdfEditor
                    ref={descriptionRef}
                    embedded
                    value={copied}
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
                      // Without the images: they are not uploaded yet, and the create sends only the text.
                      edit({ description: descriptionOf(fillImages(doc, new Map())) })
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
              </DropZone>
            </div>
            <DropZone label="Attach files to the new issue" onFiles={stage}>
              <div className="flex flex-wrap gap-2 border-y border-line px-5 py-3">
                {rules.parent && (
                  <Picker
                    label="Parent"
                    wide
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
                    className={`flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs focus-within:outline-2 focus-within:outline-accent ${estimateBad ? 'border-danger' : 'border-field-border'}`}
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
                {DATE_FIELDS.map((field) => {
                  const half = halfDates.has(field)
                  const empty = draft[field] === '' && !half
                  return (
                    <label
                      key={field}
                      className={`flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs focus-within:outline-2 focus-within:outline-accent ${half ? 'border-danger' : 'border-field-border'}`}
                    >
                      <ChipName>{field === 'startDate' ? 'Start' : 'Due'}</ChipName>
                      <span className="relative">
                        <input
                          ref={(el) => {
                            dateRefs.current[field] = el
                          }}
                          type="date"
                          max="9999-12-31"
                          aria-label={DATE_NAMES[field]}
                          aria-invalid={half || undefined}
                          value={draft[field]}
                          onChange={(event) => {
                            edit({ [field]: event.target.value })
                          }}
                          onInput={(event) => {
                            setDateHalf(field, event.currentTarget.validity.badInput)
                          }}
                          onBlur={(event) => {
                            setDateHalf(field, event.currentTarget.validity.badInput)
                          }}
                          className={`peer bg-transparent focus-visible:outline-none ${empty ? 'date-empty' : ''}`}
                        />
                        {empty && (
                          <span
                            aria-hidden
                            className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-muted peer-focus:hidden"
                          >
                            None
                          </span>
                        )}
                      </span>
                    </label>
                  )
                })}
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
                  options={withAvatars(
                    assigneeOptions(choices, assigneeQuery, me?.accountId),
                    people,
                  )}
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
                      assigneeChosen.current = true
                      edit({ assignee: meUser })
                      // This button leaves the page once the assignee is me, so focus moves first.
                      assigneeTrigger.current?.focus()
                    }}
                    className="btn btn-ghost px-2"
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
                        data-row
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
                    className="btn"
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
                      className="flex h-7 max-w-full items-center gap-1.5 rounded-md border border-field-border pl-2.5 pr-0.5 text-xs"
                    >
                      <span className="min-w-0 truncate">{file.name}</span>
                      <span className="shrink-0 text-muted">{formatSize(file.size)}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${file.name}`}
                        onClick={() => {
                          setFiles((held) => held.filter((_, at) => at !== index))
                        }}
                        className="btn btn-sm btn-icon btn-ghost btn-delete"
                      >
                        <Icon path={TRASH} />
                      </button>
                    </span>
                  ))}
                </div>
                <p id="create-needs" className="text-xs text-muted">
                  {missing.length === 0
                    ? 'Ready to create.'
                    : `Add ${listWords(missing)} to create.`}
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
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={onClose} className="btn">
                      Cancel
                    </button>
                    <button type="submit" disabled={missing.length > 0} className="btn btn-primary">
                      {attaching ? 'Attaching' : pending ? 'Creating' : 'Create issue'}
                    </button>
                  </div>
                </div>
              </div>
            </DropZone>
          </fieldset>
        </form>
      </FileDragContext>
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
