#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { issue_priority_raise, type RaiseResult } from './issue-priority-raise'

// `josh issue:priority <N>` — raise an open issue to the priority its body declares or reaches after
// filing, as a recurrence's appended cause-loss line does (joshuafolkken/kit#4960, joshuafolkken/kit#6757).

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const USAGE = 'Usage: josh issue:priority <issue-number>'

const REPORTS: Readonly<Record<RaiseResult, string>> = {
	raised: 'applied the priority label its body declares or reaches.',
	labelled: 'already carries a priority label at its level — left as it is.',
	below: 'stays at normal priority — no label applied.',
	unreadable: 'could not be read — no label applied.',
	failed: 'ranks above its labels, but applying the priority label failed.',
}

function parse_number(argv: ReadonlyArray<string>): string | undefined {
	const [first] = argv

	if (first === undefined || argv.length !== 1) return undefined

	return issue_number_shape.ISSUE_NUMBER_PATTERN.test(first) ? first : undefined
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const issue_number = parse_number(argv)

	if (issue_number === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const result = await issue_priority_raise.raise(issue_number)
	const line = `Issue ${session_cite.issue(issue_number)} ${REPORTS[result]}`
	const is_failure = issue_priority_raise.is_failure(result)

	if (is_failure) console.error(line)
	else console.info(line)

	return is_failure ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_priority_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_priority_cli }
