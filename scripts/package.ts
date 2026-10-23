// Assembles the unsigned local app at apps/desktop/dist/Jira Task Manager.app from Electron's prebuilt
// Electron.app and the desktop build in apps/desktop/out. Run it with `pnpm package`.
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = fileURLToPath(new URL('../apps/desktop/', import.meta.url))
const out = join(desktop, 'out')
// The name macOS shows. It must equal DESKTOP_NAME in packages/core/src/index.ts (a desktop test checks).
const DISPLAY_NAME = 'Jira Task Manager'
const target = join(desktop, 'dist', `${DISPLAY_NAME}.app`)
const NAME = 'jira-mgr'
const ICON = join(desktop, 'build', 'icon.icns')
const ID = 'au.com.koinon.jira-mgr'
/** Test code and the fake Jira. The real entry must hold none of it. */
const E2E_ENTRY = join(out, 'main', 'e2e.js')
const FAKE_MARKERS = ['__fakeJira', 'good-token', 'fake.atlassian.net']

/** A static `import ... from 'x'`, `import 'x'` or `require('x')` of a package, in either quote style. A dynamic `require(variable)` is not caught. */
const IMPORT = /\b(require\(|from\s*|import\s*)(["'])([^"'./][^"']*)\2/g

function fail(message: string): never {
  console.error(`package: ${message}`)
  // Leave no rejected app where someone could install it.
  rmSync(target, { recursive: true, force: true })
  process.exit(1)
}

if (process.platform !== 'darwin') fail('the app packages on macOS only.')
if (!existsSync(ICON)) fail('apps/desktop/build/icon.icns is missing. Run `pnpm icon`.')
if (!existsSync(join(out, 'main', 'index.js'))) {
  fail('apps/desktop/out is missing. Run `pnpm package`, which builds it first.')
}

// The electron package exports the path of its binary, downloading Electron on first use.
const electronBinary = createRequire(join(desktop, 'package.json'))('electron') as string
const electronApp = dirname(dirname(dirname(electronBinary)))
if (!electronApp.endsWith('Electron.app')) fail(`unexpected Electron path ${electronBinary}.`)

rmSync(target, { recursive: true, force: true })
mkdirSync(dirname(target), { recursive: true })
// ditto keeps the framework symlinks that cpSync would flatten.
execFileSync('ditto', [electronApp, target])

const appDir = join(target, 'Contents', 'Resources', 'app')
cpSync(out, join(appDir, 'out'), { recursive: true, filter: (source) => source !== E2E_ENTRY })
const { version } = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8')) as {
  version: string
}
writeFileSync(
  join(appDir, 'package.json'),
  JSON.stringify(
    { name: NAME, productName: DISPLAY_NAME, version, main: './out/main/index.js' },
    null,
    2,
  ) + '\n',
)

const plist = join(target, 'Contents', 'Info.plist')
for (const [key, value] of [
  ['CFBundleName', DISPLAY_NAME],
  ['CFBundleDisplayName', DISPLAY_NAME],
  ['CFBundleIdentifier', ID],
  ['CFBundleShortVersionString', version],
  ['CFBundleVersion', version],
] as const) {
  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} "${value}"`, plist])
}
// Replace Electron's icon with ours. The Finder and the Dock read it from the bundle.
const resources = join(target, 'Contents', 'Resources')
rmSync(join(resources, 'electron.icns'))
cpSync(ICON, join(resources, `${NAME}.icns`))
execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleIconFile ${NAME}.icns`, plist])
// macOS marks every file this app writes as downloaded (quarantine), so an attachment saved from
// Jira asks before it opens, as a browser download does. Electron's plist does not set it.
execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Add :LSFileQuarantineEnabled bool true', plist])
// Editing Info.plist breaks Electron's seal, and Apple silicon refuses a binary whose seal is
// broken. An ad-hoc signature (no identity) makes it run on this Mac.
try {
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', target], { stdio: 'pipe' })
} catch (error) {
  // codesign explains a failure on stderr; its "replacing existing signature" notice is noise.
  fail(
    `codesign failed: ${(error as { stderr?: Buffer }).stderr?.toString().trim() ?? String(error)}`,
  )
}

const files = readdirSync(appDir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name))
if (files.some((file) => file.endsWith('e2e.js'))) fail('the package holds an e2e entry.')
for (const file of files.filter((name) => name.endsWith('.js'))) {
  const text = readFileSync(file, 'utf8')
  const marker = FAKE_MARKERS.find((m) => text.includes(m))
  if (marker !== undefined) fail(`${relative(appDir, file)} holds fake Jira code (${marker}).`)
  // The renderer is a browser bundle; main and preload run in Node and carry no node_modules.
  if (!relative(appDir, file).startsWith(join('out', 'renderer'))) {
    for (const [, , , id = ''] of text.matchAll(IMPORT)) {
      if (id !== 'electron' && !id.startsWith('node:')) {
        fail(`${relative(appDir, file)} imports ${id}, which the app does not carry.`)
      }
    }
  }
}

console.log(`Packaged ${target}`)
