import type { KeyboardEvent } from 'react'

/**
 * Cmd+Enter (Ctrl+Enter off macOS) on a form: presses its submit button. It does nothing while that
 * button is disabled, so a form never submits twice, and when a picker or menu inside the form has
 * handled the key. Use it as the form's `onKeyDown`, or call it from one.
 */
export function submitOnModEnter(event: KeyboardEvent<HTMLFormElement>) {
  if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.defaultPrevented) return
  event.preventDefault()
  const form = event.currentTarget
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]')
  if (button?.disabled === true) return
  form.requestSubmit(button)
}
