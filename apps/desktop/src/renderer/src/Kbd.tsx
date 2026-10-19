import { Fragment, type ComponentProps, type ReactNode } from 'react'

/** A keycap: an 18px box with a hairline border and the hover fill, for a key name or glyph. */
export function Kbd({ className = '', ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      {...props}
      className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line bg-hover px-1 font-sans text-[11px] leading-none text-muted ${className}`}
    />
  )
}

/**
 * Draws each `backticked` run of `text` as a keycap, with Cmd as ⌘, a leading Shift as ⇧ and Enter
 * as ↵. The rest goes through `plain`, which lets a caller mark the words of a search.
 */
export function Keys({
  text,
  plain = (part) => part,
}: {
  text: string
  plain?: (part: string) => ReactNode
}) {
  return text
    .split('`')
    .map((part, at) =>
      at % 2 === 1 ? (
        <Kbd key={at}>{keycap(part.replace(/^Cmd\+?/, '⌘'))}</Kbd>
      ) : (
        <Fragment key={at}>{plain(part)}</Fragment>
      ),
    )
}

/** A keycap's text: Shift and Enter are drawn as their glyphs, as Linear's menu does. */
export const keycap = (shortcut: string) =>
  shortcut === 'Enter' ? '↵' : shortcut.replace(/^Shift\+/, '⇧')
