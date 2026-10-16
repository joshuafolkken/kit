#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { cli_flags } from '#scripts/lib/cli-flags'
import { lane_withdraw, type WithdrawOutcome } from './lane-withdraw'

// `josh lane:withdraw <issue> --reason <text>` — every explanation on standard error, and a withdrawal
// that did not end with the Issue closed exits non-zero, so a caller never takes a half-done one as done.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh lane:withdraw <issue-number> --reason <text>'
const OPTIONS = { reason: { type: 'string' } } as const

interface Request {
	issue: string
	reason: string
}

function issue_of(positionals: ReadonlyArray<string>): string | undefined {
	const [issue, ...rest] = positionals

	return rest.length === 0 && issue_number_shape.is_issue_number(issue ?? '') ? issue : undefined
}

// A reason of only whitespace is no reason: the Issue would close with an empty `Why:` line.
function reason_of(value: unknown): string | undefined {
	const reason = cli_flags.string_of(value)?.trim()

	return reason === '' ? undefined : reason
}

function parse_request(argv: ReadonlyArray<string>): Request | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)
	if (parsed === undefined) return undefined
	const issue = issue_of(parsed.positionals)
	const reason = reason_of(parsed.values.reason)

	return issue === undefined || reason === undefined ? undefined : { issue, reason }
}

function exit_code_of(outcome: WithdrawOutcome): number {
	return outcome.kind === 'withdrawn' && outcome.is_closed ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const request = parse_request(argv)

	if (request === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const outcome = await lane_withdraw.withdraw(request.issue, request.reason)

	console.error(lane_withdraw.describe(outcome, request.issue))

	return exit_code_of(outcome)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const lane_withdraw_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { lane_withdraw_cli }
