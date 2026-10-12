import type { Issue } from '@jira-mgr/core'
import { propertyRules } from '@jira-mgr/core/issue'
import {
  barText,
  bucketWorklogs,
  formatDuration,
  percentUsed,
  type ChartBar,
  type ChartPeriod,
} from '@jira-mgr/core/time-tracking'
import { useWorklogs } from './activityQueries'
import { useTimeTracking } from './queries'
import { QueryBody, Section } from './Section'
import { setChartPeriod, useChartPeriod } from './timePeriod'

/**
 * How long worklogs the Peek holds stay fresh. The page and the Peek share one list, so a read
 * the page made lately serves the Peek, and the Peek's delayed first read cannot land on a list
 * the page just changed and bring back what an edit removed.
 */
const PEEK_FRESH_MS = 30_000

const PERIODS: { id: ChartPeriod; label: string; range: string; noun: string }[] = [
  { id: 'days', label: 'Days', range: 'Last 14 days', noun: 'day' },
  { id: 'weeks', label: 'Weeks', range: 'Last 12 weeks', noun: 'week' },
  { id: 'months', label: 'Months', range: 'Last 12 months', noun: 'month' },
]

/** The tallest bar fills the chart; a bar of any time is at least 4% so it shows, and an empty one is a hairline. */
function Bars({ bars, noun }: { bars: ChartBar[]; noun: string }) {
  const tallest = Math.max(...bars.map((bar) => bar.seconds))
  return (
    <>
      <ul aria-label={`Time logged per ${noun}`} className="flex h-20 items-end gap-1">
        {bars.map((bar) => {
          const text = barText(bar)
          return (
            <li key={bar.start} title={text} className="flex h-full min-w-0 flex-1 items-end">
              <span className="sr-only">{text}</span>
              <div
                aria-hidden
                className={`w-full rounded-sm ${bar.seconds > 0 ? 'bg-accent' : 'bg-line'}`}
                style={{
                  height:
                    bar.seconds > 0
                      ? `${String(Math.max(4, (bar.seconds / tallest) * 100))}%`
                      : '1px',
                }}
              />
            </li>
          )
        })}
      </ul>
      <p aria-hidden className="flex justify-between text-xs text-muted">
        <span>{bars[0]?.label}</span>
        <span>{bars.at(-1)?.label}</span>
      </p>
    </>
  )
}

/** The hours logged per day, week or month, drawn from the issue's worklogs. */
function WorklogChart({
  issueKey,
  peek,
  load,
}: {
  issueKey: string
  peek: boolean
  load: boolean
}) {
  const worklogs = useWorklogs(issueKey, peek ? { enabled: load, staleTime: PEEK_FRESH_MS } : {})
  const period = useChartPeriod()
  const shown = PERIODS.find((p) => p.id === period) ?? PERIODS[0]
  return (
    <div className="space-y-1.5">
      <QueryBody query={worklogs} loading="Loading time logged" what="the worklogs">
        {(list) =>
          list.length === 0 ? (
            <p className="text-muted">No time logged</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted">{shown?.range}</p>
                <div
                  role="group"
                  aria-label="Chart period"
                  className="flex rounded-md border border-line p-0.5"
                >
                  {PERIODS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={period === p.id}
                      onClick={() => {
                        setChartPeriod(p.id)
                      }}
                      className="btn btn-sm btn-ghost aria-pressed:bg-selected aria-pressed:text-ink"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <Bars bars={bucketWorklogs(list, period, new Date())} noun={shown?.noun ?? 'day'} />
            </>
          )
        }
      </QueryBody>
    </div>
  )
}

/** One figure of the block: its name over its value. */
function Figure({ name, children }: { name: string; children: string }) {
  return (
    <div className="min-w-0" data-figure={name}>
      <dt className="text-xs text-muted">{name}</dt>
      <dd className="truncate text-[15px] font-semibold">{children}</dd>
    </div>
  )
}

interface TimeTrackingProps {
  issue: Issue
  /** `peek` is a small-caps block in the Peek; `page` is a section of the issue page. */
  where: 'peek' | 'page'
  /** False holds the worklog read, as the Peek does while it moves over rows. */
  load?: boolean
}

/**
 * The original estimate, the time logged and the share used, over a chart of the hours logged.
 * An Epic has none, and neither does a site with time tracking off: the block waits for the
 * site's working day, since a day has no length before it.
 */
export function TimeTracking({ issue, where, load = true }: TimeTrackingProps) {
  const settings = useTimeTracking().data
  if (!propertyRules(issue.issueType).estimates || settings == null) return null
  const hours = settings.workingHoursPerDay
  const logged = issue.timeSpentSeconds ?? 0
  const percent = percentUsed(logged, issue.originalEstimateSeconds)
  const body = (
    <div className="space-y-3">
      <dl className="grid grid-cols-3 gap-2">
        <Figure name="Estimate">
          {issue.originalEstimateSeconds === null
            ? 'No estimate'
            : formatDuration(issue.originalEstimateSeconds, hours)}
        </Figure>
        <Figure name="Logged">{formatDuration(logged, hours)}</Figure>
        {percent !== null && <Figure name="Used">{`${String(percent)}%`}</Figure>}
      </dl>
      <WorklogChart issueKey={issue.key} peek={where === 'peek'} load={load} />
    </div>
  )
  return where === 'page' ? (
    <Section title="Time tracking">{body}</Section>
  ) : (
    <section aria-label="Time tracking" className="space-y-1">
      <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted">Time tracking</h2>
      {body}
    </section>
  )
}
