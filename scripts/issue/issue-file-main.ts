#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_file_batch } from './issue-file-batch'
import { issue_file_cli } from './issue-file-cli'

// The `josh issue:file` entry, kept apart from `issue-file-cli.ts` because `upstream:interrupt` imports
// that one: a bundle is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186). `process.exitCode` rather than `process.exit()`, so the report on standard
// output drains first.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	const argv = process.argv.slice(ARGV_OFFSET)
	const filing = issue_file_batch.is_batch(argv) ? issue_file_batch : issue_file_cli

	process.exitCode = await filing.run(argv)
}
