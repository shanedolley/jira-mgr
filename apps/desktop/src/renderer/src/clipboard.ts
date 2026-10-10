/**
 * Puts `text` on the system clipboard. `navigator.clipboard` is refused here, because the window
 * grants no permission (`app.ts`), so this selects the text in a throwaway field and copies it.
 * Focus returns to where it was. Returns `false` when the browser declines the copy.
 *
 * ponytail: `execCommand` is deprecated but Electron's Chromium keeps it. If it goes, swap this body
 * for a `clipboard:write` channel to main; no caller changes.
 */
export function copyText(text: string): boolean {
  const previous = document.activeElement
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('aria-hidden', 'true')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.append(field)
  field.select()
  try {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only clipboard write the window may make; see above
    return document.execCommand('copy')
  } finally {
    field.remove()
    if (previous instanceof HTMLElement) previous.focus()
  }
}
