#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { clone_scan } from './clone-scan'

// `josh clone:scan` — count duplication across files and repositories (joshuafolkken/kit#2217).
//
// A command rather than a paragraph, for the reason `josh repo:party` is one: the `no-clones` rule
// fires on the agent's own recognition that it is about to copy something, which is exactly the moment
// the recognition is easiest to skip. This makes the duplication a number instead. `clean` on stdout
// so a caller can read the verdict; the count and the `file:line` sites follow it for a person.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh clone:scan'
const FAILURE_EXIT_CODE = 1
const FLAG_PREFIX = '-'

function run(argv: ReadonlyArray<string>): number {
	if (argv.some((argument) => !argument.startsWith(FLAG_PREFIX))) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const report = clone_scan.format_report(clone_scan.scan(process.cwd()))

	console.info(report)

	return 0
}

function main(argv: ReadonlyArray<string>): void {
	process.exitCode = run(argv)
}

const clone_scan_cli = { USAGE, main, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export { clone_scan_cli }
