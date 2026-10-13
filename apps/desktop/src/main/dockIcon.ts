import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** The Dock icon for `pnpm dev`, from the folder holding the built main file (`out/main`). */
export function devIconPath(mainDir: string): string {
  return join(mainDir, '../../build/icon.png')
}

/**
 * Sets the dev Dock icon when the PNG exists. Only the source tree has it: the packaged app
 * carries its icon in the bundle, and Electron reports `isPackaged` false there, so the file
 * check is what tells the two apart. `dock` is undefined off macOS.
 */
export function setDevDockIcon(
  mainDir: string,
  dock: { setIcon: (path: string) => void } | undefined,
): void {
  const path = devIconPath(mainDir)
  if (dock !== undefined && existsSync(path)) dock.setIcon(path)
}
