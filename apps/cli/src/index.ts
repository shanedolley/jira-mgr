#!/usr/bin/env node
import { nodeIo } from './context.js'
import { run } from './run.js'

const code = await run(process.argv.slice(2), nodeIo())
process.exitCode = code
// An interrupted request may keep the event loop alive, so do not wait for it.
if (code === 130) process.exit(code)
