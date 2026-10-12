import type { ChartPeriod } from '@jira-mgr/core/time-tracking'
import { useSyncExternalStore } from 'react'

/** The chart's period holds for the session, across the Peek and the issue page, and starts on days. */
let held: ChartPeriod = 'days'
const listeners = new Set<() => void>()

export function setChartPeriod(period: ChartPeriod): void {
  held = period
  listeners.forEach((listener) => {
    listener()
  })
}

export function useChartPeriod(): ChartPeriod {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => held,
  )
}
