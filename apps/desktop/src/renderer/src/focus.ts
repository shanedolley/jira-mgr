import { focusManager } from '@tanstack/react-query'

import type { JmApi } from '../../shared/ipc'

/**
 * Makes TanStack Query's focus state follow the Electron window. Its default listens to
 * `visibilitychange`, which Chromium raises when a window hides but not when another app
 * takes focus, so a switch back would not refetch.
 */
export function bridgeWindowFocus(onWindowFocus: JmApi['onWindowFocus']): void {
  focusManager.setEventListener((setFocused) => onWindowFocus(setFocused))
}
