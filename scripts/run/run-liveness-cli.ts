#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { lane_await } from '#scripts/lane/lane-await'
import { cli_flags } from '#scripts/lib/cli-flags'
import { error_text } from '#scripts/lib/error-message'
import { run_issue_number } from './run-issue-number'
import {
	MS_PER_MINUTE,
	MS_PER_SECOND,
	PROCESS_ALIVE,
	PROCESS_NONE,
	PROCESS_UNKNOWN,
	run_liveness,
	UNDETERMINED_VERDICT,
	type LivenessDecision,
	type LivenessRequest,
	type ProcessTrace,
} from './run-liveness'

// `josh run:liveness <N> --output <path> [--process <alive|none>]` — one verdict about the delegated
// unit running child `<N>`.
//
// The stdout/stderr split is the contract, as it is for `run:hold`: exactly one
// verdict token on stdout on every path, the reason and the advice on stderr. `undetermined` exits
// non-zero, because a caller that read nothing must not proceed as though it had.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const USAGE =
	'Usage: josh run:liveness <issue-number> --output <path> [--process alive|none] [--window <minutes>] [--gap <seconds>] [--repo <owner/repo>]'
// Whole and positive, both of them. A zero window would call any unit not writing at that instant
// frozen, and a zero gap would take both samples back-to-back — together they book a live unit as
// stopped, which is the one error direction this command is built to avoid.
const DURATION_PATTERN = /^[1-9]\d*$/u

const PROCESS_TRACES: ReadonlyArray<ProcessTrace> = [PROCESS_ALIVE, PROCESS_NONE, PROCESS_UNKNOWN]

function report(decision: LivenessDecision): number {
	console.error(`${decision.reason}\n${decision.advice}`)
	console.info(decision.verdict)

	return decision.verdict === UNDETERMINED_VERDICT ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE
}

// A read that threw is the same answer as a trace that could not be read, and it is printed the same
// way rather than as a stack trace a caller would have to interpret.
function report_undetermined(reason: string): number {
	console.error(reason)
	console.info(UNDETERMINED_VERDICT)

	return FAILURE_EXIT_CODE
}

function report_usage(): number {
	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

function to_process_trace(raw: string | undefined): ProcessTrace | undefined {
	if (raw === undefined) return PROCESS_UNKNOWN

	return PROCESS_TRACES.find((trace) => trace === raw)
}

function to_ms(raw: string | undefined, unit_ms: number): number | undefined {
	return raw === undefined ? undefined : Number(raw) * unit_ms
}

// A malformed duration is refused rather than silently replaced by the default: a caller that meant
// to widen the window and mistyped it would otherwise be answered against the 30-minute one.
function is_valid_duration(raw: string | undefined): boolean {
	return raw === undefined || DURATION_PATTERN.test(raw)
}

const OPTIONS = {
	gap: { type: 'string' },
	output: { type: 'string' },
	process: { type: 'string' },
	repo: { type: 'string' },
	window: { type: 'string' },
} as const

type OptionName = keyof typeof OPTIONS
type ParsedValues = Partial<Record<OptionName, string>>

interface ParsedArguments {
	positionals: ReadonlyArray<string>
	values: ParsedValues
}

function is_valid_target(parsed: ParsedArguments): boolean {
	return (
		parsed.positionals.length === 1 &&
		run_issue_number.ISSUE_NUMBER_PATTERN.test(parsed.positionals[0] ?? '')
	)
}

function is_valid_options(values: ParsedValues): boolean {
	return values.output !== undefined && to_process_trace(values.process) !== undefined
}

function is_valid(parsed: ParsedArguments): boolean {
	return (
		is_valid_target(parsed) &&
		is_valid_options(parsed.values) &&
		is_valid_duration(parsed.values.gap) &&
		is_valid_duration(parsed.values.window)
	)
}

function to_optional_fields(values: ParsedValues): Partial<LivenessRequest> {
	const gap_ms = to_ms(values.gap, MS_PER_SECOND)
	const silent_window_ms = to_ms(values.window, MS_PER_MINUTE)

	return {
		...(gap_ms !== undefined && { gap_ms }),
		...(silent_window_ms !== undefined && { silent_window_ms }),
		...(values.repo !== undefined && { repo: values.repo }),
	}
}

// Left out, the process trace is read here with the probe `lane:await` polls on — the child's
// invocation or its detached ship — so no caller runs `pgrep` by hand; a
// probe that could not look answers `unknown`, never `none`. A given `--process` still wins: it is
// the answer for a unit this probe does not know, such as one whose checkout the caller scanned itself.
function process_trace_of(values: ParsedValues, issue: string): ProcessTrace {
	if (values.process !== undefined) return to_process_trace(values.process) ?? PROCESS_UNKNOWN

	return lane_await.process_trace_default(issue)
}

// Reached only through `is_valid`, so the fallbacks below are unreachable defaults rather than
// behavior: the alternative is a type assertion, which this codebase restricts.
function to_request(parsed: ParsedArguments): LivenessRequest {
	const issue = parsed.positionals[0] ?? ''

	return {
		issue,
		output_path: parsed.values.output ?? '',
		process_trace: process_trace_of(parsed.values, issue),
		...to_optional_fields(parsed.values),
	}
}

function parse_request(argv: ReadonlyArray<string>): LivenessRequest | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)

	if (parsed === undefined || !is_valid(parsed)) return undefined

	return to_request(parsed)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const request = parse_request(argv)

	if (request === undefined) return report_usage()

	try {
		return report(await run_liveness.check(request))
	} catch (error) {
		return report_undetermined(error_text.message_of(error))
	}
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_liveness_cli = { USAGE, parse_request, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_liveness_cli }
