import { useEffect, useLayoutEffect, useState, useSyncExternalStore, type RefObject } from 'react'

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

/**
 * The y of the Tree's top edge inside the issue list, so the Peek card can start below the
 * toolbar and the view tabs and cover no control. It is `null` until the Tree is on screen. The
 * Tree carries `data-tree-pane`.
 */
export function useTreeTop(list: RefObject<HTMLElement | null>, active: boolean): number | null {
  const [top, setTop] = useState<number | null>(null)
  const measure = () => {
    const section = list.current
    const tree = section?.querySelector('[data-tree-pane]')
    if (!active || section == null || tree == null) return
    setTop(Math.round(tree.getBoundingClientRect().top - section.getBoundingClientRect().top))
  }
  // After every render, because a banner or a filter chip moves the Tree without resizing the list.
  useLayoutEffect(measure)
  useEffect(() => {
    const section = list.current
    if (!active || section === null) return
    const observer = new ResizeObserver(measure)
    observer.observe(section)
    return () => {
      observer.disconnect()
    }
  }, [list, active])
  return top
}
