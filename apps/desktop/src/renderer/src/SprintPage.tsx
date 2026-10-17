import type { RowProperty } from '@jira-mgr/core/display'
import type { SprintReport } from '@jira-mgr/core/sprints'
import { useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'

import { Avatar } from './Avatar'
import { LoadError } from './LoadError'
import { STATE_LABELS } from './properties'
import { SECTION_HEADING } from './Section'
import { StatusDot, summaryFade } from './StatusDot'
import {
  BREAKDOWNS,
  formatDay,
  groupByStatus,
  percentOf,
  shareText,
  type BreakdownId,
} from './sprintView'
import { useSprintReport } from './sprintQueries'
import { Properties } from './TreeRow'

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-b border-line py-3 last:border-b-0">
      <h3 className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="grid min-h-8 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-1">
      <dt className="truncate px-2 text-muted">{name}</dt>
      <dd className="min-w-0 truncate px-2">{children}</dd>
    </div>
  )
}

/** One number of the progress block: its name, the count and, for started and completed, the share. */
function Count({ name, value, share }: { name: string; value: number; share?: number }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{name}</dt>
      <dd className="text-[15px] font-semibold">
        {value}{' '}
        {share !== undefined && (
          <span className="ml-1 text-xs font-normal text-muted">{`${String(share)}%`}</span>
        )}
      </dd>
    </div>
  )
}

/** The tabs of the breakdowns. Arrow keys, Home and End move between them and select as they go. */
function Breakdowns({ stats }: { stats: SprintReport['stats'] }) {
  const [selected, setSelected] = useState<BreakdownId>('assignees')
  const tabs = useRef(new Map<BreakdownId, HTMLButtonElement>())

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const at = BREAKDOWNS.findIndex((tab) => tab.id === selected)
    const to =
      event.key === 'ArrowRight'
        ? (at + 1) % BREAKDOWNS.length
        : event.key === 'ArrowLeft'
          ? (at + BREAKDOWNS.length - 1) % BREAKDOWNS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? BREAKDOWNS.length - 1
              : -1
    const next = BREAKDOWNS[to]
    if (next === undefined) return
    event.preventDefault()
    setSelected(next.id)
    tabs.current.get(next.id)?.focus()
  }

  const groups = stats[selected]
  return (
    <div className="space-y-2 pt-3">
      <div
        role="tablist"
        aria-label="Breakdown"
        onKeyDown={onKeyDown}
        className="flex flex-wrap gap-1.5"
      >
        {BREAKDOWNS.map((tab) => (
          <button
            key={tab.id}
            ref={(button) => {
              if (button === null) tabs.current.delete(tab.id)
              else tabs.current.set(tab.id, button)
            }}
            type="button"
            role="tab"
            id={`sprint-tab-${tab.id}`}
            aria-selected={selected === tab.id}
            aria-controls="sprint-tabpanel"
            tabIndex={selected === tab.id ? 0 : -1}
            onClick={() => {
              setSelected(tab.id)
            }}
            className={`btn btn-sm ${selected === tab.id ? 'is-current' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="sprint-tabpanel" aria-labelledby={`sprint-tab-${selected}`}>
        {groups.length === 0 ? (
          <p className="px-2 text-muted">Nothing to show.</p>
        ) : (
          <ul>
            {groups.map((group) => (
              <li key={group.id} className="flex min-h-8 items-center gap-2 px-2">
                {selected === 'assignees' && (
                  <Avatar
                    person={
                      group.id === ''
                        ? null
                        : {
                            accountId: group.id,
                            displayName: group.name,
                            avatarUrl: group.avatarUrl ?? null,
                          }
                    }
                  />
                )}
                <span className="min-w-0 flex-1 truncate" title={group.name}>
                  {group.name}
                </span>
                <span className="shrink-0 text-xs text-muted">{shareText(group)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** The right panel: dates, goal, and the counts with their progress bar and breakdown tabs. */
function Panel({ report }: { report: SprintReport }) {
  const { sprint, stats } = report
  const completed = percentOf(stats.completed, stats.scope)
  const started = percentOf(stats.started, stats.scope)
  return (
    <aside
      aria-label="Sprint details"
      className="min-h-0 overflow-y-auto border-l border-line bg-panel px-3 max-stack:min-h-auto max-stack:overflow-y-visible max-stack:border-l-0 max-stack:border-t"
    >
      <Group title="Dates">
        <dl>
          <Field name="Status">{STATE_LABELS[sprint.state]}</Field>
          <Field name="Start">{formatDay(sprint.startDate)}</Field>
          <Field name="End">{formatDay(sprint.endDate)}</Field>
        </dl>
      </Group>
      <Group title="Goal">
        {sprint.goal === null ? (
          <p className="px-2 text-muted">No goal set</p>
        ) : (
          <p className="whitespace-pre-wrap break-words px-2">{sprint.goal}</p>
        )}
      </Group>
      <Group title="Progress">
        <dl className="grid grid-cols-3 gap-2 px-2">
          <Count name="Scope" value={stats.scope} />
          <Count name="Started" value={stats.started} share={started} />
          <Count name="Completed" value={stats.completed} share={completed} />
        </dl>
        <div
          role="progressbar"
          aria-label="Sprint progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={completed}
          aria-valuetext={`${String(completed)}% completed, ${String(started)}% started`}
          className="mx-2 mt-3 flex h-2 overflow-hidden rounded-full bg-line"
        >
          <div className="bg-status-done" style={{ width: `${String(completed)}%` }} />
          <div className="bg-status-doing" style={{ width: `${String(started)}%` }} />
        </div>
        <Breakdowns key={sprint.id} stats={stats} />
      </Group>
    </aside>
  )
}

/** The sprint's issues, grouped by status, each opening its page. */
function Issues({
  report,
  properties,
  today,
  onOpen,
}: {
  report: SprintReport
  properties: readonly RowProperty[]
  today: string
  onOpen: (key: string) => void
}) {
  const { sprint, issues } = report
  const groups = groupByStatus(issues)
  return (
    <article className="min-h-0 overflow-y-auto px-8 pb-6 pt-4 text-sm leading-[22px] max-stack:min-h-auto max-stack:overflow-y-visible max-stack:px-4">
      <div className="space-y-6">
        <div className="max-w-[40rem] space-y-1">
          <h1 className="text-xl font-semibold leading-7">{sprint.name}</h1>
          <p role="status" className="text-muted">
            {issues.length === 1 ? '1 issue' : `${String(issues.length)} issues`}
          </p>
        </div>
        {groups.length === 0 && <p className="text-muted">No issues in this sprint.</p>}
        {groups.map(({ status, issues: inGroup }) => (
          <section key={status.id} aria-label={status.name} className="space-y-1">
            <h2 className={`${SECTION_HEADING} flex max-w-[40rem] items-center gap-2`}>
              <StatusDot status={status} />
              {status.name}
              <span className="font-normal text-muted">{inGroup.length}</span>
            </h2>
            <ul
              className={`divide-y divide-line rounded-md border border-line ${properties.length === 0 ? 'max-w-[40rem]' : 'max-w-[64rem]'}`}
            >
              {inGroup.map((issue) => (
                <li key={issue.key}>
                  <button
                    type="button"
                    data-row
                    data-issue-key={issue.key}
                    onClick={() => {
                      onOpen(issue.key)
                    }}
                    className="flex min-h-8 w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1 text-left hover:bg-hover"
                  >
                    <span className="w-20 shrink-0 font-mono text-xs text-muted">{issue.key}</span>
                    <span
                      className={`flex-1 truncate ${properties.length === 0 ? 'min-w-0' : 'min-w-[10rem]'}`}
                      style={summaryFade(status)}
                    >
                      {issue.summary}
                    </span>
                    <Properties issue={issue} properties={properties} today={today} always />
                    <Avatar person={issue.assignee} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </article>
  )
}

interface SprintPageProps {
  sprintId: number
  /** The row properties the Display menu chose, which the Tree shows too. */
  properties: readonly RowProperty[]
  /** Today's local date, which the short dates and the due date's colour read. */
  today: string
  pageRef: RefObject<HTMLElement | null>
  onBack: () => void
  /** Opens the page of one of the sprint's issues. */
  onOpenIssue: (key: string) => void
}

/**
 * The page of one sprint: its issues by status beside a panel of dates, goal, counts and
 * breakdowns. Completed means the status category is Done. It shows the last copy it read at
 * once and reads again on opening. Esc and Back return to the Tree.
 */
export function SprintPage({
  sprintId,
  properties,
  today,
  pageRef,
  onBack,
  onOpenIssue,
}: SprintPageProps) {
  const report = useSprintReport(sprintId)

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    onBack()
  }

  return (
    <section
      ref={pageRef}
      tabIndex={-1}
      aria-label="Sprint page"
      onKeyDown={onKeyDown}
      className="relative z-10 grid h-full min-h-0 grid-cols-[minmax(0,1fr)_21rem] grid-rows-[auto_minmax(0,1fr)] bg-canvas focus-visible:outline-none max-stack:grid-cols-[minmax(0,1fr)] max-stack:grid-rows-[auto] max-stack:content-start max-stack:overflow-y-auto"
    >
      <header className="app-drag col-span-2 flex h-10 items-center gap-3 border-b border-line px-4 max-rail:pl-6 max-stack:sticky max-stack:top-0 max-stack:z-10 max-stack:col-span-1 max-stack:bg-canvas">
        <button type="button" onClick={onBack} className="btn btn-sm app-no-drag">
          Back to issues
        </button>
      </header>
      {report.data === undefined ? (
        <div className="col-span-2 max-stack:col-span-1">
          {report.isError ? (
            <LoadError
              what="this sprint"
              error={report.error}
              onRetry={() => void report.refetch()}
            />
          ) : (
            <p role="status" className="p-6 text-muted">
              Loading sprint
            </p>
          )}
        </div>
      ) : (
        <>
          <Issues report={report.data} properties={properties} today={today} onOpen={onOpenIssue} />
          <Panel report={report.data} />
        </>
      )}
    </section>
  )
}
