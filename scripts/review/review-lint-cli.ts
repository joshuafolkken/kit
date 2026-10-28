#!/usr/bin/env tsx
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { review_brief_cli } from './review-brief-cli'
import { review_lint } from './review-lint'

// `josh review:lint` — read a review's markdown from stdin and print `ok`, or the rubric's format
// violations one per line, exiting non-zero so the reviewer runs it before returning its findings.
// `--round 2` checks the verification pass's shape instead of the full template.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const OK_MESSAGE = 'ok'
const ARGV_OFFSET = 2
const USAGE = 'Usage: josh review:lint [--round <1|2>] < review.md'
const NO_INPUT_MESSAGE =
	'✖ nothing on stdin — pipe the review in, e.g. `pnpm josh review:lint < review.md`'

// The lines to print on failure — a usage error, no input, or the violations — empty on a pass.
function failure_lines(review: string, argv: ReadonlyArray<string>): ReadonlyArray<string> {
	const round = review_brief_cli.parse_round(argv)
	if (round === undefined) return [USAGE]
	if (review.trim().length === 0) return [NO_INPUT_MESSAGE]

	return review_lint.with_reference(review_lint.lint_review(review, round), round)
}

function run(review: string, argv: ReadonlyArray<string>): number {
	const failures = failure_lines(review, argv)

	if (failures.length > 0) {
		console.error(failures.join('\n'))

		return FAILURE_EXIT_CODE
	}

	console.info(OK_MESSAGE)

	return SUCCESS_EXIT_CODE
}

async function read_and_run(): Promise<number> {
	const argv = process.argv.slice(ARGV_OFFSET)
	if (process.stdin.isTTY) return run('', argv)

	return run(await text(process.stdin), argv)
}

async function main(): Promise<void> {
	process.exitCode = await read_and_run()
}

const review_lint_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export { review_lint_cli }
