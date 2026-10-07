// Runs the built CLI. pnpm forwards a literal "--", so drop it to let `pnpm jm -- --help` work.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../apps/cli/dist/index.js', import.meta.url))
const args = process.argv.slice(2)
if (args[0] === '--') args.shift()

const { status } = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit' })
process.exit(status ?? 1)
