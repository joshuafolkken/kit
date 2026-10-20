#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_scout_cli } from './issue-scout-cli'

// The `josh issue:scout` entry, kept apart from `issue-scout-cli.ts` because other modules import
// that one: a bundle is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186). `process.exitCode` rather than `process.exit()`: the answer goes to
// standard output and a write to a pipe is asynchronous on macOS, so exiting can tear the process
// down before it drains.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await issue_scout_cli.run(process.argv.slice(ARGV_OFFSET))
}
