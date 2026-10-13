import { join } from 'node:path'

/** The Dock icon for `pnpm dev`, from the folder holding the built main file (`out/main`). */
export function devIconPath(mainDir: string): string {
  return join(mainDir, '../../build/icon.png')
}
