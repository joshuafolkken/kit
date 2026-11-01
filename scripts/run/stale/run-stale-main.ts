#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { run_stale_cli } from './run-stale-cli'

// The `josh run:stale` entry, kept apart from `run-stale-cli.ts` so the module carries no main guard
// (joshuafolkken/kit#4186). The command takes no arguments.
if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await run_stale_cli.run()
