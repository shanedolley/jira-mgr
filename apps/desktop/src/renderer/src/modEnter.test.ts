import type { KeyboardEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { submitOnModEnter } from './modEnter'

interface Press {
  key?: string
  metaKey?: boolean
  ctrlKey?: boolean
  defaultPrevented?: boolean
  isComposing?: boolean
  /** `null` is a form with no submit button; otherwise whether the button is disabled. */
  disabled?: boolean | null
}

/** A key event on a form whose submit button is `disabled`, with the calls it received. */
function press({
  key = 'Enter',
  defaultPrevented = false,
  isComposing = false,
  disabled = false,
  ...mods
}: Press) {
  const button = disabled === null ? null : { disabled }
  const form = { querySelector: vi.fn(() => button), requestSubmit: vi.fn() }
  const preventDefault = vi.fn()
  submitOnModEnter({
    key,
    metaKey: false,
    ctrlKey: false,
    defaultPrevented,
    preventDefault,
    nativeEvent: { isComposing },
    currentTarget: form,
    ...mods,
  } as unknown as KeyboardEvent<HTMLFormElement>)
  return { form, button, preventDefault }
}

describe('submitOnModEnter', () => {
  it('presses the submit button on Cmd+Enter and on Ctrl+Enter', () => {
    for (const mods of [{ metaKey: true }, { ctrlKey: true }]) {
      const { form, button, preventDefault } = press(mods)
      expect(form.requestSubmit).toHaveBeenCalledExactlyOnceWith(button)
      expect(preventDefault).toHaveBeenCalled()
    }
  })

  it('leaves a plain Enter and other keys with the form', () => {
    for (const sent of [{}, { key: 'a', metaKey: true }]) {
      const { form, preventDefault } = press(sent)
      expect(form.requestSubmit).not.toHaveBeenCalled()
      expect(preventDefault).not.toHaveBeenCalled()
    }
  })

  it('submits nothing while the button is disabled', () => {
    const { form } = press({ metaKey: true, disabled: true })
    expect(form.requestSubmit).not.toHaveBeenCalled()
  })

  it('submits nothing when a picker or menu has already taken the key', () => {
    const { form } = press({ metaKey: true, defaultPrevented: true })
    expect(form.requestSubmit).not.toHaveBeenCalled()
  })

  it('submits nothing while an input method is composing', () => {
    const { form } = press({ metaKey: true, isComposing: true })
    expect(form.requestSubmit).not.toHaveBeenCalled()
  })

  it('submits a form with no submit button as the form is', () => {
    const { form } = press({ ctrlKey: true, disabled: null })
    expect(form.requestSubmit).toHaveBeenCalledOnce()
  })
})
