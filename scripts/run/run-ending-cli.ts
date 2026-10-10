#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { cli_flags } from '#scripts/lib/cli-flags'
import { error_text } from '#scripts/lib/error-message'
import {
	run_ending,
	UNREADABLE_VERDICT,
	type EndingDecision,
	type EndingRequest,
} from './run-ending'

// `josh run:ending <N> --output <path> [--repo <owner/repo>]` — one verdict about how the dispatched
// lane child running `<N>` ended.
//
// The stdout/stderr split is the contract `run:liveness` and `run:hold` keep: exactly one verdict
// token on stdout on every path, the reason and the basis on stderr. `unreadable` exits non-zero,
// because a caller that could not read a trace must not act as though it had classified the ending.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const USAGE = 'Usage: josh run:ending <issue-number> --output <path> [--repo <owner/repo>]'

function report(decision: EndingDecision): number {
	console.error(`${decision.reason}\n${decision.evidence}`)
	console.info(decision.verdict)

	return decision.verdict === UNREADABLE_VERDICT ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE
}

// A read that threw is the same answer as a trace that could not be read, printed as the verdict a
// caller can branch on rather than as a stack trace.
function report_unreadable(reason: string): number {
	console.error(reason)
	console.info(UNREADABLE_VERDICT)

	return FAILURE_EXIT_CODE
}

function report_usage(): number {
	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

const OPTIONS = {
	output: { type: 'string' },
	repo: { type: 'string' },
} as const

type ParsedValues = Partial<Record<keyof typeof OPTIONS, string>>

interface ParsedArguments {
	positionals: ReadonlyArray<string>
	values: ParsedValues
}

function is_valid(parsed: ParsedArguments): boolean {
	return (
		parsed.positionals.length === 1 &&
		issue_number_shape.ISSUE_NUMBER_PATTERN.test(parsed.positionals[0] ?? '') &&
		parsed.values.output !== undefined
	)
}

// Reached only through `is_valid`, so the fallbacks are unreachable defaults rather than behavior.
function to_request(parsed: ParsedArguments): EndingRequest {
	return {
		issue: parsed.positionals[0] ?? '',
		output_path: parsed.values.output ?? '',
		...(parsed.values.repo !== undefined && { repo: parsed.values.repo }),
	}
}

function parse_request(argv: ReadonlyArray<string>): EndingRequest | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)

	if (parsed === undefined || !is_valid(parsed)) return undefined

	return to_request(parsed)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const request = parse_request(argv)

	if (request === undefined) return report_usage()

	try {
		return report(await run_ending.check(request))
	} catch (error) {
		return report_unreadable(error_text.message_of(error))
	}
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_ending_cli = { USAGE, parse_request, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_ending_cli }
