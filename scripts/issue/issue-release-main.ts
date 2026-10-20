#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_release_cli } from './issue-release-cli'

// The `josh issue:release` entry, kept apart from `issue-release-cli.ts` because other modules import
// that one: a bundle is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186). `process.exitCode` rather than `process.exit()`, so the report on standard
// output drains first.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await issue_release_cli.run(process.argv.slice(ARGV_OFFSET))
}
