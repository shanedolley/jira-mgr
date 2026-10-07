#!/usr/bin/env node
import { appTitle } from '@jira-mgr/core'
import { Command } from 'commander'

import pkg from '../package.json' with { type: 'json' }

const program = new Command('jm').description(appTitle(pkg.version)).version(pkg.version)

await program.parseAsync()
