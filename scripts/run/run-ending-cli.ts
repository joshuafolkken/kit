#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
	run_ending,
	UNREADABLE_VERDICT,
	type EndingDecision,
	type EndingRequest,
} from './run-ending'
import { run_issue_number } from './run-issue-number'

// `josh run:ending <N> --output <path> [--repo <owner/repo>]` — one verdict about how the dispatched
// lane child running `<N>` ended (joshuafolkken/kit#2139).
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

function read_arguments(argv: ReadonlyArray<string>): ParsedArguments | undefined {
	try {
		return parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true })
	} catch {
		return undefined
	}
}

function is_valid(parsed: ParsedArguments): boolean {
	return (
		parsed.positionals.length === 1 &&
		run_issue_number.ISSUE_NUMBER_PATTERN.test(parsed.positionals[0] ?? '') &&
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
	const parsed = read_arguments(argv)

	if (parsed === undefined || !is_valid(parsed)) return undefined

	return to_request(parsed)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const request = parse_request(argv)

	if (request === undefined) return report_usage()

	try {
		return report(await run_ending.check(request))
	} catch (error) {
		return report_unreadable(error instanceof Error ? error.message : String(error))
	}
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_ending_cli = { USAGE, main, parse_request, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_ending_cli }
