import type { ComponentProps } from 'react'

/** A keycap: an 18px box with a hairline border and the hover fill, for a key name or glyph. */
export function Kbd({ className = '', ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      {...props}
      className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line bg-hover px-1 font-sans text-[11px] leading-none text-muted ${className}`}
    />
  )
}

/** Draws each `backticked` run of `text` as a keycap, and Cmd as the ⌘ glyph. */
export function Keys({ text }: { text: string }) {
  return text
    .split('`')
    .map((part, at) => (at % 2 === 1 ? <Kbd key={at}>{part.replace(/^Cmd\+?/, '⌘')}</Kbd> : part))
}

/** A keycap's text: Shift and Enter are drawn as their glyphs, as Linear's menu does. */
export const keycap = (shortcut: string) =>
  shortcut === 'Enter' ? '↵' : shortcut.replace(/^Shift\+/, '⇧')
