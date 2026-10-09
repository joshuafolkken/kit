#!/usr/bin/env tsx
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { behavior_change_lint } from './behavior-change-lint'
import { issue_classification } from './issue-classification'
import { issue_lint } from './issue-lint'

// `josh issue:lint <path>` — read an Issue body from a file and print `ok`, or every template problem
// one per line, exiting non-zero. It reads a path rather than stdin so it can
// lint a body written to a file before the `gh api … issues` call that files it. A body that declares
// itself a behavior-change Issue is additionally held to the firing-point, baseline and reproduction
// rules.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const OK_MESSAGE = 'ok'
const NO_LABELS = 'none'
const USAGE = 'Usage: josh issue:lint <path-to-issue-body>'

// Every problem a body has: the four base template headings it lacks, then the behavior-change
// problems (empty for an Issue that does not declare itself one).
function problems(body: string): ReadonlyArray<string> {
	const missing = issue_lint.missing_headings(body).map((heading) => `missing heading: ${heading}`)

	return [
		...missing,
		...behavior_change_lint.problems(body),
		...issue_classification.problems(body),
	]
}

function report(found: ReadonlyArray<string>, body: string): number {
	if (found.length === 0) {
		console.info(OK_MESSAGE)
		console.info(`labels: ${issue_classification.required_labels(body).join(', ') || NO_LABELS}`)

		return SUCCESS_EXIT_CODE
	}

	console.error(found.map((problem) => `✖ ${problem}`).join('\n'))

	return FAILURE_EXIT_CODE
}

async function run(body_path: string | undefined): Promise<number> {
	if (body_path === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const body = await readFile(body_path, 'utf8')

	return report(problems(body), body)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv[0])
}

const issue_lint_cli = { problems, run }

const ARGV_OFFSET = 2

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_lint_cli }
