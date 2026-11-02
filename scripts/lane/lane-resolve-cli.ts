#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { error_text } from '#scripts/lib/error-message'
import { lane_resolve } from './lane-resolve'

// `josh lane:resolve <issue>` — the verdict line on standard output, exit 0; a refusal, an unreadable
// thread or a git failure on standard error, exit 1, so a caller never reads a half-judged merge.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh lane:resolve <issue-number>'

function issue_of(argv: ReadonlyArray<string>): string | undefined {
	const [issue, ...rest] = argv

	return rest.length === 0 && issue_number_shape.is_issue_number(issue ?? '') ? issue : undefined
}

async function judge(issue: string): Promise<number> {
	const outcome = await lane_resolve.resolve(issue)

	if (outcome.kind === 'refused') {
		console.error(outcome.message)

		return FAILURE_EXIT_CODE
	}

	console.info(lane_resolve.verdict_line(outcome))

	return SUCCESS_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const issue = issue_of(argv)

	if (issue === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	try {
		return await judge(issue)
	} catch (error) {
		console.error(error_text.message_of(error))

		return FAILURE_EXIT_CODE
	}
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const lane_resolve_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { lane_resolve_cli }
