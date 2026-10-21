#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { run_tidy_cli } from './run-tidy-cli'

// The `josh run:tidy` entry, kept apart from `run-tidy-cli.ts` because `run:hold` imports that one: a
// bundle is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186). The sweep takes no arguments and never sets an exit code.
if (process.argv[1] === fileURLToPath(import.meta.url)) await run_tidy_cli.sweep()
