import type { Issue } from '@jira-mgr/core'

import { StatusDot } from './StatusDot'
import { useIssues, useLogout } from './queries'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

function Row({
  issue,
  selected,
  onSelect,
}: {
  issue: Issue
  selected: boolean
  onSelect: () => void
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={onSelect}
        className="flex w-full items-center gap-3 px-4 py-1.5 text-left hover:bg-hover aria-[current=true]:bg-selected"
      >
        <StatusDot status={issue.status} />
        <span className="w-24 shrink-0 font-mono text-xs text-muted">{issue.key}</span>
        <span className="min-w-0 flex-1 truncate">{issue.summary}</span>
        <span className="shrink-0 text-xs text-muted">{issue.issueType.name}</span>
        <span
          role="img"
          aria-label={issue.assignee?.displayName ?? 'Unassigned'}
          className="grid size-5 shrink-0 place-items-center rounded-full border border-line text-[10px] text-muted"
        >
          {issue.assignee === null ? '' : initials(issue.assignee.displayName)}
        </span>
      </button>
    </li>
  )
}

interface IssueListProps {
  selectedKey: string | null
  onSelect: (key: string) => void
}

/** A flat list of the project's unresolved issues. D2 replaces it with the tree. */
export function IssueList({ selectedKey, onSelect }: IssueListProps) {
  const issues = useIssues()
  const logout = useLogout()

  let body
  if (issues.isPending) {
    body = (
      <p role="status" className="p-4 text-muted">
        Loading issues...
      </p>
    )
  } else if (issues.isError) {
    body = (
      <div role="alert" className="space-y-3 p-4">
        <p className="text-danger">{issues.error.message}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void issues.refetch()}
            className="rounded-md border border-line px-3 py-1 hover:bg-hover"
          >
            Retry
          </button>
          {issues.error.code === 'permission_denied' && (
            <button
              type="button"
              onClick={() => {
                logout.mutate()
              }}
              className="rounded-md border border-line px-3 py-1 hover:bg-hover"
            >
              Log in again
            </button>
          )}
        </div>
      </div>
    )
  } else if (issues.data.length === 0) {
    body = <p className="p-4 text-muted">No unresolved issues.</p>
  } else {
    body = (
      <ul aria-label="Issues">
        {issues.data.map((issue) => (
          <Row
            key={issue.key}
            issue={issue}
            selected={issue.key === selectedKey}
            onSelect={() => {
              onSelect(issue.key)
            }}
          />
        ))}
      </ul>
    )
  }

  return (
    <section aria-label="Issue list" className="flex min-h-0 flex-col bg-canvas">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-line px-4">
        <h1 className="font-semibold">Issues</h1>
        <span role="status" className="text-xs text-muted">
          {issues.isFetching && !issues.isPending ? 'Updating...' : ''}
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </section>
  )
}
