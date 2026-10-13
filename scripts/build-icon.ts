// Rebuilds the app icon from apps/desktop/build/icon.svg: icon.png for the `pnpm dev` Dock and
// icon.icns for `pnpm package`. Electron renders the SVG, so the script runs inside it:
// `pnpm icon`.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The slice of Electron's API this script uses. Electron is not a dependency of `scripts/`. */
interface Win {
  loadURL: (url: string) => Promise<void>
  webContents: { capturePage: () => Promise<{ toPNG: () => Buffer }> }
  close: () => void
}
interface Electron {
  app: {
    commandLine: { appendSwitch: (name: string, value: string) => void }
    whenReady: () => Promise<void>
    quit: () => void
  }
  BrowserWindow: new (options: object) => Win
}
const { app, BrowserWindow } = createRequire(import.meta.url)('electron') as Electron

const build = fileURLToPath(new URL('../apps/desktop/build/', import.meta.url))
const svg = readFileSync(join(build, 'icon.svg'), 'utf8')
/** Every size macOS asks for, rendered from the vector so small sizes stay crisp. */
const SIZES = [16, 32, 64, 128, 256, 512, 1024]
/** The `.iconset` names and the size each holds. */
const ICONSET: Record<string, number> = {
  'icon_16x16.png': 16,
  'icon_16x16@2x.png': 32,
  'icon_32x32.png': 32,
  'icon_32x32@2x.png': 64,
  'icon_128x128.png': 128,
  'icon_128x128@2x.png': 256,
  'icon_256x256.png': 256,
  'icon_256x256@2x.png': 512,
  'icon_512x512.png': 512,
  'icon_512x512@2x.png': 1024,
}
/** Where `pnpm dev` finds the Dock icon. */
const DEV_PNG = 512

function fail(message: string): never {
  console.error(`icon: ${message}`)
  process.exit(1)
}

/** PNG width and height, read from the IHDR chunk. */
function pngSize(png: Buffer): [number, number] {
  if (png.toString('latin1', 1, 4) !== 'PNG') fail('a render is not a PNG.')
  return [png.readUInt32BE(16), png.readUInt32BE(20)]
}

async function render(size: number): Promise<Buffer> {
  const window = new BrowserWindow({
    width: size,
    height: size,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
  })
  const px = `${String(size)}px`
  const page = `<!doctype html><style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block;width:${px};height:${px}}</style>${svg}`
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`)
  const png = (await window.webContents.capturePage()).toPNG()
  window.close()
  const [width, height] = pngSize(png)
  if (width !== size || height !== size)
    fail(`rendered ${String(width)}x${String(height)}, wanted ${String(size)}.`)
  return png
}

async function main(): Promise<void> {
  await app.whenReady()
  const renders = new Map<number, Buffer>()
  for (const size of SIZES) renders.set(size, await render(size))
  const png = (size: number): Buffer => renders.get(size) ?? fail(`no ${String(size)} px render.`)

  const iconset = join(mkdtempSync(join(tmpdir(), 'jira-mgr-icon-')), 'icon.iconset')
  execFileSync('mkdir', [iconset])
  for (const [name, size] of Object.entries(ICONSET)) writeFileSync(join(iconset, name), png(size))
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(build, 'icon.icns')])
  rmSync(iconset, { recursive: true, force: true })
  writeFileSync(join(build, 'icon.png'), png(DEV_PNG))

  const icns = readFileSync(join(build, 'icon.icns'))
  if (icns.toString('latin1', 0, 4) !== 'icns') fail('icon.icns is not an icns file.')
  console.log(`Wrote icon.png (${String(DEV_PNG)} px) and icon.icns to ${build}`)
}

// One pixel per CSS pixel, whatever the display, so each render is the size it names.
app.commandLine.appendSwitch('force-device-scale-factor', '1')
// Electron starts the app only after the main module finishes loading, so nothing here awaits at
// the top level.
main()
  .catch((error: unknown) => {
    console.error(`icon: ${String(error)}`)
    process.exitCode = 1
  })
  .finally(() => {
    app.quit()
  })
