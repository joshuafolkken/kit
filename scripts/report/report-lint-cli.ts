#!/usr/bin/env tsx
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { josh_environment_file } from '#scripts/josh/josh-environment-file'
import { report_lint } from './report-lint'
import { report_lint_child_summary } from './report-lint-child-summary'

// `josh report:lint` — read a two-layer work summary candidate from stdin and print `ok`, or the
// mechanical violations one per line, exiting non-zero so it works as a gate. `--child-summary`
// checks a lane child's closing summary instead.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const OK_MESSAGE = 'ok'
const CHILD_SUMMARY_FLAG = '--child-summary'
const NO_INPUT_MESSAGE =
	'✖ nothing on stdin — pipe the summary in, e.g. `pnpm josh report:lint < summary.md`'

function lint(summary: string, is_child_summary: boolean): ReadonlyArray<string> {
	if (is_child_summary) {
		return report_lint_child_summary.with_reference(
			report_lint_child_summary.lint_child_summary(summary),
		)
	}

	return report_lint.with_reference(report_lint.lint_report(summary))
}

function run(summary: string, is_child_summary: boolean): number {
	if (summary.trim().length === 0) {
		console.error(NO_INPUT_MESSAGE)

		return FAILURE_EXIT_CODE
	}

	const violations = lint(summary, is_child_summary)

	if (violations.length === 0) {
		console.info(OK_MESSAGE)

		return SUCCESS_EXIT_CODE
	}

	console.error(violations.join('\n'))

	return FAILURE_EXIT_CODE
}

async function read_and_run(): Promise<number> {
	const is_child_summary = process.argv.includes(CHILD_SUMMARY_FLAG)
	if (process.stdin.isTTY) return run('', is_child_summary)

	return run(await text(process.stdin), is_child_summary)
}

// `.env` is read here, on the command path alone, so the labels follow the session language.
async function main(): Promise<void> {
	josh_environment_file.load_environment_file()
	process.exitCode = await read_and_run()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
