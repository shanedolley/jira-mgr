import { useState } from 'react'

import type { Session } from '../../shared/ipc'
import { IssueDetail } from './IssueDetail'
import { IssueList } from './IssueList'
import { Sidebar } from './Sidebar'
import { useIssues } from './queries'

/** Sidebar, list and detail. The detail issue is read from the query cache, so an edit shows in both. */
export function Shell({ session }: { session: Session }) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const issues = useIssues()
  const selected = issues.data?.find((issue) => issue.key === selectedKey)

  return (
    <div className="grid h-full grid-cols-[14.5rem_minmax(20rem,1fr)_minmax(21rem,26rem)]">
      <Sidebar session={session} count={issues.data?.length} />
      <IssueList selectedKey={selectedKey} onSelect={setSelectedKey} />
      <IssueDetail issue={selected} />
    </div>
  )
}
