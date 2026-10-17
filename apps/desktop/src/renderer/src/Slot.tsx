import type { ButtonHTMLAttributes, Ref } from 'react'

/**
 * Every interactive control in a Sprint page row's content carries this. The content ignores the
 * pointer (`pointer-events-none`), so a click outside a control reaches the overlay button under it
 * and opens the issue; this takes the pointer back for one control.
 */
export const SLOT = 'pointer-events-auto'

/**
 * A Sprint page row's control: a real button beside the row's overlay button, never inside it. A
 * cell draws it in place of its Tree form while `always` is set, so `data-prop` and `data-pick`
 * stay on the control itself.
 */
export function Slot({
  className = '',
  ref,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement> }) {
  return <button ref={ref} type="button" className={`${SLOT} ${className}`} {...rest} />
}
