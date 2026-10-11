import type { Issue, JiraMgrError } from '@jira-mgr/core'
import type { Progress } from '@jira-mgr/core/hierarchy'
import { propertyRules, type IssueDetail } from '@jira-mgr/core/issue'
import { useEffect, type DragEvent, type KeyboardEvent, type RefObject } from 'react'

import { IMAGE_TYPES, type CurrentUser } from '../../shared/ipc'
import { AttachmentsSection } from './AttachmentsSection'
import { useAttach } from './attach'
import { CommentsSection } from './CommentsSection'
import { CustomerMismatch, useMatchCustomer, type Mismatch } from './CustomerMismatch'
import type { Notice } from './create'
import { DescriptionEditor } from './DescriptionEditor'
import { dropDraftsOf, hasDraftsOf } from './drafts'
import { isClaimed } from './DropZone'
import { FileDragContext, useFileDrag } from './fileDrag'
import { IssueProperties } from './IssueProperties'
import { LinksSection } from './LinksSection'
import { LoadError } from './LoadError'
import { ProgressPill } from './Progress'
import { SECTION_HEADING } from './Section'
import { StatusDot } from './StatusDot'
import { SubtasksSection } from './SubtasksSection'
import { SummaryEditor } from './SummaryEditor'
import { pressOf } from './timer'
import { TimerClock } from './TimerClock'
import { useTimer } from './timerQueries'
import { useIssueDetail } from './queries'
import { TypeIcon } from './TypeIcon'
import { removeUploadsOf } from './uploads'
import { WorklogsSection } from './WorklogsSection'

interface IssuePageProps {
  issueKey: string
  /** Every loaded issue: the pickers draw recent assignees, labels and parents from them. */
  issues: readonly Issue[]
  /** Done over total of each parent's children: the "Sub-issue of" line shows its parent's. */
  progress: ReadonlyMap<string, Progress>
  me: CurrentUser | undefined
  /** Set when the issue's Customer differs from its Epic's. */
  mismatch: Mismatch | null
  onBack: () => void
  /** Opens the page of another issue, such as the parent or a subtask. */
  onOpen: (key: string) => void
  /** Opens the page of the issue's sprint. */
  onOpenSprint: (id: number) => void
  /** Opens the delete confirmation for the issue. */
  onDelete: (issue: Issue) => void
  pageRef: RefObject<HTMLElement | null>
  /** Reports something to the user in the corner of the window. */
  onNotice: (notice: Notice) => void
  /** `T` or the timer button: starts the timer, or opens the stop or switch dialog. */
  onTimer: (issueKey: string) => void
}

/** "Sub-issue of KEY Summary" with the parent's progress, which opens the parent. */
function ParentLine({
  parentKey,
  parent,
  progress,
  onOpen,
}: {
  parentKey: string
  /** `undefined` while the parent is not among the loaded issues. */
  parent: Issue | undefined
  progress: Progress | undefined
  onOpen: (key: string) => void
}) {
  return (
    <p className="flex min-w-0 items-center gap-2 text-muted">
      <span className="shrink-0">Sub-issue of</span>
      <button
        type="button"
        data-row
        data-parent-line
        onClick={() => {
          onOpen(parentKey)
        }}
        className="flex min-w-0 items-center gap-1.5 rounded text-left hover:text-ink"
      >
        {parent !== undefined && <TypeIcon type={parent.issueType} />}
        <span className="shrink-0 font-mono text-xs">{parentKey}</span>
        {parent !== undefined && (
          <span className="min-w-0 truncate text-ink">{parent.summary}</span>
        )}
      </button>
      {progress !== undefined && <ProgressPill progress={progress} />}
    </p>
  )
}

function PageBody({
  issue,
  detail,
  issues,
  progress,
  me,
  mismatch,
  onOpen,
  onOpenSprint,
  onLeave,
  onNotice,
  detailError,
  onRetry,
  attach,
  uploading,
}: Pick<
  IssuePageProps,
  'issues' | 'progress' | 'me' | 'mismatch' | 'onOpen' | 'onOpenSprint' | 'onNotice'
> & {
  issue: Issue
  detail: IssueDetail | undefined
  /** Puts focus back on the page once an editor's controls are gone. */
  onLeave: () => void
  /** Why the page's own read failed, while it holds no read. */
  detailError: JiraMgrError | null
  onRetry: () => void
  /** Attaches files to the issue: every drop that is not an embedded image ends here. */
  attach: (files: File[]) => void
  /** Names of the files still going up. */
  uploading: string[]
}) {
  const fix = useMatchCustomer(issue)
  // An Epic takes no worklogs (CONTEXT), the same switch D3 uses for its estimates.
  const worklogs = propertyRules(issue.issueType).estimates
  return (
    <>
      <article className="min-h-0 overflow-y-auto px-8 pb-6 pt-4 text-sm leading-[22px] max-stack:min-h-auto max-stack:overflow-y-visible max-stack:px-4">
        <div className="max-w-[40rem] space-y-8">
          {/* Closer to the description than the sections are to each other, so it starts by y=140. */}
          <div className="mb-6 space-y-1">
            <h1 className="flex items-center gap-2 font-mono text-xs text-muted">
              <TypeIcon type={issue.issueType} />
              <StatusDot status={issue.status} />
              {issue.key}
            </h1>
            <SummaryEditor issue={issue} onEditingChange={() => undefined} onLeave={onLeave} page />
            {issue.parentKey !== null && (
              <ParentLine
                parentKey={issue.parentKey}
                parent={issues.find((i) => i.key === issue.parentKey)}
                progress={progress.get(issue.parentKey)}
                onOpen={onOpen}
              />
            )}
          </div>
          {mismatch !== null && (
            <CustomerMismatch
              mismatch={mismatch}
              onMatch={() => {
                fix.match(mismatch)
              }}
            />
          )}
          {fix.error !== null && (
            <p role="alert" className="text-xs text-danger">
              {fix.error}
            </p>
          )}
          <section aria-label="Description" className="space-y-1">
            <h2 className={SECTION_HEADING}>Description</h2>
            {detailError !== null ? (
              <LoadError what="the description" error={detailError} onRetry={onRetry} />
            ) : detail === undefined ? (
              <p className="text-muted">Loading description</p>
            ) : (
              <DescriptionEditor
                issueKey={issue.key}
                value={detail.description}
                onLeave={onLeave}
                onNotice={onNotice}
                onAttach={attach}
              />
            )}
          </section>
          <SubtasksSection
            issue={issue}
            detail={detail}
            detailError={detailError}
            onOpen={onOpen}
            onNotice={onNotice}
          />
          <LinksSection issueKey={issue.key} issues={issues} onOpen={onOpen} onNotice={onNotice} />
          {worklogs && <WorklogsSection issueKey={issue.key} me={me} onNotice={onNotice} />}
          <CommentsSection issueKey={issue.key} me={me} onLeave={onLeave} onNotice={onNotice} />
          <AttachmentsSection
            issueKey={issue.key}
            attach={attach}
            uploading={uploading}
            onNotice={onNotice}
          />
        </div>
      </article>
      <IssueProperties issue={issue} issues={issues} me={me} onOpenSprint={onOpenSprint} />
    </>
  )
}

/**
 * The full page of one issue: summary, description and subtasks beside the properties sidebar.
 * It shows the issue from the loaded lists at once, then takes its own read, which adds the
 * description and subtasks. Esc and Back return to the Tree.
 */
export function IssuePage({
  issueKey,
  issues,
  progress,
  me,
  mismatch,
  onBack,
  onOpen,
  onOpenSprint,
  onDelete,
  pageRef,
  onNotice,
  onTimer,
}: IssuePageProps) {
  const timer = useTimer().data?.timer ?? null
  const dragging = useFileDrag()
  const detail = useIssueDetail(issueKey)
  const { attach, uploading } = useAttach(issueKey, onNotice)

  // An issue deleted since (here or in Jira) has no page: go back to the Tree and say so.
  const gone = detail.error?.code === 'not_found'
  useEffect(() => {
    if (!gone) return
    // Its draft and uploads go with it, or they would hold up a quit and a logout for nothing.
    const hadDraft = hasDraftsOf(issueKey)
    dropDraftsOf(issueKey)
    removeUploadsOf(issueKey)
    onBack()
    onNotice({
      title: `${issueKey} no longer exists`,
      notes: hadDraft ? ['Its unsaved description was dropped.'] : [],
      warned: false,
    })
    // Only the moment the issue goes missing matters, not each render's callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gone])
  const issue: Issue | undefined = detail.data ?? issues.find((i) => i.key === issueKey)

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    // Esc inside a picker, a field, an editor or a dialog belongs to that control.
    const target = event.target as Element
    if (
      target.closest(
        '[popover], dialog, input, textarea, select, [contenteditable="true"], [role="alertdialog"]',
      ) !== null
    ) {
      return
    }
    event.preventDefault()
    onBack()
  }

  /**
   * A file dropped anywhere no zone took attaches (Q34). An editor that embedded images took
   * those, so only the other files of that drop attach.
   */
  function onDrop(event: DragEvent<HTMLElement>) {
    if (isClaimed(event.nativeEvent) || !event.dataTransfer.types.includes('Files')) return
    const taken = event.defaultPrevented
    const files = Array.from(event.dataTransfer.files)
    const rest = taken
      ? files.filter((file) => !(IMAGE_TYPES as readonly string[]).includes(file.type))
      : files
    if (rest.length > 0) attach(rest)
  }

  return (
    <FileDragContext value={dragging}>
      <section
        ref={pageRef}
        tabIndex={-1}
        data-key-scope
        aria-label="Issue page"
        onKeyDown={onKeyDown}
        onDrop={onDrop}
        className="relative z-10 grid h-full min-h-0 grid-cols-[minmax(0,1fr)_21rem] grid-rows-[auto_minmax(0,1fr)] bg-canvas focus-visible:outline-none max-stack:grid-cols-[minmax(0,1fr)] max-stack:grid-rows-[auto] max-stack:content-start max-stack:overflow-y-auto"
      >
        <header className="app-drag col-span-2 flex h-10 items-center gap-3 border-b border-line px-4 max-rail:pl-6 max-stack:sticky max-stack:top-0 max-stack:z-10 max-stack:col-span-1 max-stack:bg-canvas">
          <button type="button" onClick={onBack} className="btn btn-sm app-no-drag">
            Back to issues
          </button>
          {issue !== undefined && (
            <div className="app-no-drag ml-auto flex items-center gap-2">
              {propertyRules(issue.issueType).estimates && (
                <>
                  <TimerClock issueKey={issue.key} />
                  <button
                    type="button"
                    aria-keyshortcuts="T"
                    onClick={() => {
                      onTimer(issue.key)
                    }}
                    className="btn btn-sm"
                  >
                    {pressOf(timer, issue.key) === 'stop' ? 'Stop timer' : 'Start timer'}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  onDelete(issue)
                }}
                className="btn btn-sm btn-delete"
              >
                Delete
              </button>
            </div>
          )}
        </header>
        {issue === undefined ? (
          <div className="col-span-2 max-stack:col-span-1">
            {detail.isError ? (
              <LoadError
                what="this issue"
                error={detail.error}
                onRetry={() => void detail.refetch()}
              />
            ) : (
              <p role="status" className="p-6 text-muted">
                Loading {issueKey}
              </p>
            )}
          </div>
        ) : (
          // Keyed by the issue, so opening another drops the edit state and errors of the last.
          <PageBody
            key={issue.key}
            issue={issue}
            detail={detail.data}
            detailError={detail.isError && detail.data === undefined ? detail.error : null}
            onRetry={() => void detail.refetch()}
            onLeave={() => pageRef.current?.focus()}
            attach={attach}
            uploading={uploading}
            issues={issues}
            progress={progress}
            me={me}
            mismatch={mismatch}
            onOpen={onOpen}
            onOpenSprint={onOpenSprint}
            onNotice={onNotice}
          />
        )}
      </section>
    </FileDragContext>
  )
}
