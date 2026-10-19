import { Icon, MONITOR, MOON, SUN } from './Icon'
import { THEMES, setTheme, useTheme } from './theme'

const CHOICES = {
  system: { label: 'System', path: MONITOR },
  light: { label: 'Light', path: SUN },
  dark: { label: 'Dark', path: MOON },
} as const

/** Three icon buttons; System, the default, follows the operating system. */
export function ThemeToggle() {
  const current = useTheme()
  return (
    <div role="group" aria-label="Theme" className="flex w-fit rounded-md border border-line p-0.5">
      {THEMES.map((theme) => (
        <button
          key={theme}
          type="button"
          aria-label={CHOICES[theme].label}
          title={CHOICES[theme].label}
          aria-pressed={current === theme}
          onClick={() => {
            setTheme(theme)
          }}
          className="btn btn-sm btn-icon btn-ghost aria-pressed:bg-selected aria-pressed:text-ink"
        >
          <Icon path={CHOICES[theme].path} className="size-4" />
        </button>
      ))}
    </div>
  )
}
