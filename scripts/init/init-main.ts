#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { run_cli } from './init'

// The `josh init` entry, kept apart from `init.ts` because other modules import that one: a bundle is
// one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186). `run_cli` sets its own exit code.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	run_cli(process.argv.slice(ARGV_OFFSET))
}
