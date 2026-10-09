import type { Issue, JiraMgrError } from '@jira-mgr/core'
import { propertyRules, type IssueDetail } from '@jira-mgr/core/issue'
import { useEffect, type DragEvent, type KeyboardEvent, type RefObject } from 'react'

import { IMAGE_TYPES, type CurrentUser } from '../../shared/ipc'
import { AttachmentsSection } from './AttachmentsSection'
import { useAttach } from './attach'
import { CommentsSection } from './CommentsSection'
import { CustomerMismatch, useMatchCustomer, type Mismatch } from './CustomerMismatch'
import type { Notice } from './create'
import { DescriptionEditor } from './DescriptionEditor'
import { dropDraft, getDraft } from './drafts'
import { isClaimed } from './DropZone'
import { FileDragContext, useFileDrag } from './fileDrag'
import { IssueProperties } from './IssueProperties'
import { LinksSection } from './LinksSection'
import { LoadError } from './LoadError'
import { StatusDot } from './StatusDot'
import { SummaryEditor } from './SummaryEditor'
import { useIssueDetail } from './queries'
import { TypeIcon } from './TypeIcon'
import { removeUploadsOf } from './uploads'
import { WorklogsSection } from './WorklogsSection'

interface IssuePageProps {
  issueKey: string
  /** Every loaded issue: the pickers draw recent assignees, labels and parents from them. */
  issues: readonly Issue[]
  me: CurrentUser | undefined
  /** Set when the issue's Customer differs from its Epic's. */
  mismatch: Mismatch | null
  onBack: () => void
  /** Opens the page of another issue, such as the parent or a subtask. */
  onOpen: (key: string) => void
  /** Opens the delete confirmation for the issue. */
  onDelete: (issue: Issue) => void
  pageRef: RefObject<HTMLElement | null>
  /** Reports something to the user in the corner of the window. */
  onNotice: (notice: Notice) => void
}

function PageBody({
  issue,
  detail,
  issues,
  me,
  mismatch,
  onOpen,
  onLeave,
  onNotice,
  detailError,
  onRetry,
  attach,
  uploading,
}: Pick<IssuePageProps, 'issues' | 'me' | 'mismatch' | 'onOpen' | 'onNotice'> & {
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
      <article className="min-h-0 space-y-6 overflow-y-auto px-8 py-6">
        <div className="max-w-3xl space-y-6">
          <div className="space-y-2">
            <h1 className="flex items-center gap-2 font-mono text-xs text-muted">
              <TypeIcon type={issue.issueType} />
              <StatusDot status={issue.status} />
              {issue.key}
            </h1>
            <SummaryEditor issue={issue} onEditingChange={() => undefined} onLeave={onLeave} />
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
            <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Description
            </h2>
            {detailError !== null ? (
              <LoadError error={detailError} onRetry={onRetry} />
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
          {detail !== undefined && detail.subtasks.length > 0 && (
            <section aria-label="Subtasks" className="space-y-1">
              <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted">
                Subtasks
              </h2>
              <ul className="divide-y divide-line rounded-md border border-line">
                {detail.subtasks.map((subtask) => (
                  <li key={subtask.key}>
                    <button
                      type="button"
                      onClick={() => {
                        onOpen(subtask.key)
                      }}
                      className="flex h-8 w-full items-center gap-3 px-3 text-left hover:bg-hover"
                    >
                      <span className="w-20 shrink-0 font-mono text-xs text-muted">
                        {subtask.key}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{subtask.summary}</span>
                      <span className="shrink-0 text-xs text-muted">{subtask.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
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
      <IssueProperties issue={issue} issues={issues} me={me} />
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
  me,
  mismatch,
  onBack,
  onOpen,
  onDelete,
  pageRef,
  onNotice,
}: IssuePageProps) {
  const dragging = useFileDrag()
  const detail = useIssueDetail(issueKey)
  const { attach, uploading } = useAttach(issueKey, onNotice)

  // An issue deleted since (here or in Jira) has no page: go back to the Tree and say so.
  const gone = detail.error?.code === 'not_found'
  useEffect(() => {
    if (!gone) return
    // Its draft and uploads go with it, or they would hold up a quit and a logout for nothing.
    const hadDraft = getDraft(issueKey) !== undefined
    dropDraft(issueKey)
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

  const parentKey = issue?.parentKey ?? null

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
        aria-label="Issue page"
        onKeyDown={onKeyDown}
        onDrop={onDrop}
        className="relative z-10 grid h-full min-h-0 grid-cols-[minmax(0,1fr)_21rem] grid-rows-[auto_minmax(0,1fr)] bg-canvas focus-visible:outline-none"
      >
        <header className="app-drag col-span-2 flex h-10 items-center gap-3 border-b border-line px-4">
          <button
            type="button"
            onClick={onBack}
            className="app-no-drag rounded-md border border-line px-2 py-0.5 text-xs hover:bg-hover"
          >
            Back to issues
          </button>
          {parentKey !== null && (
            <span className="app-no-drag flex items-center gap-1.5 text-xs text-muted">
              <span aria-hidden>in</span>
              <button
                type="button"
                onClick={() => {
                  onOpen(parentKey)
                }}
                className="font-mono hover:text-ink"
              >
                {parentKey}
              </button>
            </span>
          )}
          {issue !== undefined && (
            <button
              type="button"
              onClick={() => {
                onDelete(issue)
              }}
              className="app-no-drag ml-auto rounded-md border border-line px-2 py-0.5 text-xs text-danger hover:bg-hover"
            >
              Delete
            </button>
          )}
        </header>
        {issue === undefined ? (
          <div className="col-span-2">
            {detail.isError ? (
              <LoadError error={detail.error} onRetry={() => void detail.refetch()} />
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
            me={me}
            mismatch={mismatch}
            onOpen={onOpen}
            onNotice={onNotice}
          />
        )}
      </section>
    </FileDragContext>
  )
}
