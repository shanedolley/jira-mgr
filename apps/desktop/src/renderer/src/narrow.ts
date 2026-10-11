import { useSyncExternalStore } from 'react'

/** A window under 960px at the default type size: the sidebar is a rail. It is `--breakpoint-rail` in `styles.css`. */
const RAIL = '(width < 60rem)'

function subscribe(listener: () => void): () => void {
  const query = window.matchMedia(RAIL)
  query.addEventListener('change', listener)
  return () => {
    query.removeEventListener('change', listener)
  }
}

/** True while the window is narrower than the rail breakpoint, at any zoom. */
export function useRail(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(RAIL).matches)
}
