#!/usr/bin/env tsx
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { report_lint } from './report-lint'

// `josh report:lint` — read a two-layer work summary candidate from stdin and print `ok`, or the
// mechanical violations one per line, exiting non-zero so it works as a gate (joshuafolkken/kit#2123).

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const OK_MESSAGE = 'ok'
const NO_INPUT_MESSAGE =
	'✖ nothing on stdin — pipe the work summary in, e.g. `pnpm josh report:lint < summary.md`'

function run(summary: string): number {
	if (summary.trim().length === 0) {
		console.error(NO_INPUT_MESSAGE)

		return FAILURE_EXIT_CODE
	}

	const violations = report_lint.lint_report(summary)

	if (violations.length === 0) {
		console.info(OK_MESSAGE)

		return SUCCESS_EXIT_CODE
	}

	console.error(violations.join('\n'))

	return FAILURE_EXIT_CODE
}

async function read_and_run(): Promise<number> {
	if (process.stdin.isTTY) return run('')

	return run(await text(process.stdin))
}

async function main(): Promise<void> {
	process.exitCode = await read_and_run()
}

const report_lint_cli = { run, OK_MESSAGE }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export { report_lint_cli }
