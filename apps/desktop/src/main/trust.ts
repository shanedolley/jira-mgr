import { fileURLToPath } from 'node:url'

/** The parts of Electron's `WebFrameMain` the check reads, so it runs without Electron. */
export interface FrameLike {
  url: string
}

/** A page's identity without its query string or fragment. `null` when `url` is not a URL. */
function documentOf(url: string): string | null {
  if (!URL.canParse(url)) return null
  const parsed = new URL(url)
  return parsed.protocol === 'file:' ? fileURLToPath(parsed) : `${parsed.origin}${parsed.pathname}`
}

/**
 * True when `frame` is the main frame of our own window (the same object, so a subframe or a
 * frame of another window fails) and still shows our own page. A navigation away from it, which
 * `will-navigate` should prevent anyway, loses the right to call the backend.
 */
export function isTrustedFrame(
  frame: FrameLike | null | undefined,
  mainFrame: FrameLike,
  ownUrl: string,
): boolean {
  if (frame === null || frame === undefined || frame !== mainFrame) return false
  const own = documentOf(ownUrl)
  return own !== null && documentOf(frame.url) === own
}
