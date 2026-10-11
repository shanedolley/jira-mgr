import type { Issue } from '@jira-mgr/core'
import { customerTotals, type CustomerOption } from '@jira-mgr/core/hierarchy'
import { useMemo, type RefObject } from 'react'

import { Banner } from './Banner'
import { OVERVIEW_ROW, OverviewFrame, TH, type OverviewLoad } from './OverviewFrame'
import { NotLoaded, PercentDone } from './Progress'

/**
 * The Customers page: every Customer of the Project with the issues it has open and the share of
 * its issues that is Done. A row opens the Tree filtered to that Customer, which under the default
 * toggles shows that many open issues (the Tree also shows the Epic of a mismatched child as
 * context). The counts are the loaded issues', so they grow once the Done issues load, and the
 * percent reads "Not loaded" if that load fails.
 */
export function CustomersPage({
  issues,
  customers,
  customersFailed,
  doneLoading,
  load,
  front,
  pageRef,
  onBack,
  onOpen,
  onRetry,
}: {
  issues: readonly Issue[]
  /** The Project's Customer options, `undefined` until they load. */
  customers: readonly CustomerOption[] | undefined
  /** The Customer list failed to load, so the page lists the Customers the issues name. */
  customersFailed: boolean
  /** The Done issues are still loading, so the counts are not final. */
  doneLoading: boolean
  load: OverviewLoad
  front: boolean
  pageRef: RefObject<HTMLElement | null>
  onBack: () => void
  onOpen: (customer: CustomerOption) => void
  onRetry: () => void
}) {
  const rows = useMemo(() => customerTotals(issues, customers ?? []), [issues, customers])
  const loading = customers === undefined && !customersFailed
  const count = `${String(rows.length)} ${rows.length === 1 ? 'Customer' : 'Customers'}`
  return (
    <OverviewFrame
      title="Customers"
      front={front}
      pageRef={pageRef}
      onBack={onBack}
      count={loading ? '' : count}
      doneLoading={doneLoading}
      load={load}
    >
      {customersFailed && (
        <Banner onRetry={onRetry}>
          Could not load the Customer list, so Customers with no issue are missing.
        </Banner>
      )}
      {loading ? (
        <p role="status" className="p-4 text-muted">
          Loading Customers
        </p>
      ) : rows.length === 0 ? (
        <p className="p-4 text-muted">No Customers.</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-4 text-sm">
          <table className="w-full min-w-[28rem] border-collapse">
            <thead>
              <tr>
                <th scope="col" className={TH}>
                  Customer
                </th>
                <th scope="col" className={`${TH} w-28`}>
                  Open
                </th>
                <th scope="col" className={`${TH} w-40`}>
                  % done
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ customer, open, done }) => (
                <tr
                  key={customer.id}
                  onClick={() => {
                    onOpen(customer)
                  }}
                  className="h-10 cursor-default border-t border-line hover:bg-hover"
                >
                  <th scope="row" className="max-w-0 px-3 text-left font-normal">
                    <button
                      type="button"
                      {...OVERVIEW_ROW}
                      data-overview-key={customer.id}
                      className="block w-full truncate text-left font-medium"
                    >
                      {customer.value}
                    </button>
                  </th>
                  <td className="px-3 tabular-nums">{open}</td>
                  <td
                    className="px-3 whitespace-nowrap"
                    title={
                      load.doneFailed || open + done === 0
                        ? undefined
                        : `${String(done)} of ${String(open + done)} done`
                    }
                  >
                    {load.doneFailed ? (
                      <NotLoaded />
                    ) : (
                      <PercentDone progress={{ done, total: open + done }} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </OverviewFrame>
  )
}
