import { THEMES, setTheme, useTheme } from './theme'

const LABELS = { system: 'System', light: 'Light', dark: 'Dark' } as const

/** Three choices; System, the default, follows the operating system. */
export function ThemeToggle() {
  const current = useTheme()
  return (
    <div role="group" aria-label="Theme" className="flex rounded-md border border-line p-0.5">
      {THEMES.map((theme) => (
        <button
          key={theme}
          type="button"
          aria-pressed={current === theme}
          onClick={() => {
            setTheme(theme)
          }}
          className="flex-1 rounded px-2 py-0.5 text-xs text-muted hover:text-ink aria-pressed:bg-selected aria-pressed:text-ink"
        >
          {LABELS[theme]}
        </button>
      ))}
    </div>
  )
}
