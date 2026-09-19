#!/usr/bin/env tsx
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { issue_lint } from './issue-lint'

// `josh issue:lint <path>` — read an Issue body from a file and print `ok`, or the missing template
// headings one per line, exiting non-zero (joshuafolkken/kit#2123). It reads a path rather than stdin
// so it can lint a body written to a file before the `gh api … issues` call that files it.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const OK_MESSAGE = 'ok'
const USAGE = 'Usage: josh issue:lint <path-to-issue-body>'

function report(missing: ReadonlyArray<string>): number {
	if (missing.length === 0) {
		console.info(OK_MESSAGE)

		return SUCCESS_EXIT_CODE
	}

	console.error(missing.map((heading) => `✖ missing heading: ${heading}`).join('\n'))

	return FAILURE_EXIT_CODE
}

async function run(body_path: string | undefined): Promise<number> {
	if (body_path === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const body = await readFile(body_path, 'utf8')

	return report(issue_lint.missing_headings(body))
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv[0])
}

const issue_lint_cli = { run, OK_MESSAGE, USAGE }

const ARGV_OFFSET = 2

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_lint_cli }
