import { useSyncExternalStore } from 'react'

export const THEMES = ['system', 'light', 'dark'] as const
export type ThemePreference = (typeof THEMES)[number]

const STORAGE_KEY = 'jm-theme'

function read(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return THEMES.find((theme) => theme === stored) ?? 'system'
  } catch {
    return 'system'
  }
}

let preference = read()
const listeners = new Set<() => void>()

/** `system` removes the attribute, so the stylesheet follows `prefers-color-scheme`. */
export function applyTheme(theme: ThemePreference = preference): void {
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
}

export function setTheme(theme: ThemePreference): void {
  preference = theme
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // The choice then lasts until the app quits, which is better than failing the click.
  }
  applyTheme(theme)
  listeners.forEach((listener) => {
    listener()
  })
}

export function useTheme(): ThemePreference {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => preference,
  )
}
