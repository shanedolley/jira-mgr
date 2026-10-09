import type { Issue, JiraMgrError } from '@jira-mgr/core'
import { adfToMarkdown } from '@jira-mgr/core/adf'
import type { IssueDetail } from '@jira-mgr/core/issue'
import { useMemo, type KeyboardEvent, type RefObject } from 'react'

import type { CurrentUser } from '../../shared/ipc'
import { CustomerMismatch, useMatchCustomer, type Mismatch } from './CustomerMismatch'
import { IssueProperties } from './IssueProperties'
import { LoadError } from './LoadError'
import { StatusDot } from './StatusDot'
import { SummaryEditor } from './SummaryEditor'
import { useIssueDetail } from './queries'

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
  pageRef: RefObject<HTMLElement | null>
}

/** The description as Markdown text, or why it cannot show. The editor is D4's. */
function descriptionText(description: IssueDetail['description']): string | null {
  if (description === null) return null
  try {
    return adfToMarkdown(description)
  } catch {
    return 'This description cannot be shown here yet. It is unchanged in Jira.'
  }
}

function PageBody({
  issue,
  detail,
  issues,
  me,
  mismatch,
  onOpen,
  onLeave,
  detailError,
  onRetry,
}: Pick<IssuePageProps, 'issues' | 'me' | 'mismatch' | 'onOpen'> & {
  issue: Issue
  detail: IssueDetail | undefined
  /** Puts focus back on the page once an editor's controls are gone. */
  onLeave: () => void
  /** Why the page's own read failed, while it holds no read. */
  detailError: JiraMgrError | null
  onRetry: () => void
}) {
  const fix = useMatchCustomer(issue)
  const description = useMemo(
    () => (detail === undefined ? undefined : descriptionText(detail.description)),
    [detail],
  )
  return (
    <>
      <article className="min-h-0 space-y-6 overflow-y-auto px-8 py-6">
        <div className="max-w-3xl space-y-6">
          <div className="space-y-2">
            <h1 className="flex items-center gap-2 font-mono text-xs text-muted">
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
            ) : description === undefined ? (
              <p className="text-muted">Loading description</p>
            ) : description === null ? (
              <p className="text-muted">No description</p>
            ) : (
              <p className="whitespace-pre-wrap break-words">{description}</p>
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
  pageRef,
}: IssuePageProps) {
  const detail = useIssueDetail(issueKey)
  const issue: Issue | undefined = detail.data ?? issues.find((i) => i.key === issueKey)

  const parentKey = issue?.parentKey ?? null

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    // Esc inside a picker, a field or a dialog belongs to that control.
    const target = event.target as Element
    if (target.closest('[popover], dialog, input, textarea, select') !== null) return
    event.preventDefault()
    onBack()
  }

  return (
    <section
      ref={pageRef}
      tabIndex={-1}
      aria-label="Issue page"
      onKeyDown={onKeyDown}
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
          issues={issues}
          me={me}
          mismatch={mismatch}
          onOpen={onOpen}
        />
      )}
    </section>
  )
}
