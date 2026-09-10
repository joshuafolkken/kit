#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { lane_close, type CloseOutcome, type SweepOutcome } from './lane-close'
import { lane_open, type OpenOutcome } from './lane-open'
import { lane_output, type ReadOutcome, type RecordOutcome } from './lane-output'
import { lane_registry, type LaneInfo } from './lane-registry'
import { lane_report } from './lane-report'
import { lane_seed_policy } from './lane-seed'

// `josh lane:open` / `lane:close` / `lane:list` / `lane:prune` — the lane's whole lifecycle
// (joshuafolkken/kit#1490).
//
// **`lane:open` prints the lane's directory on standard output and nothing else**, so
// `dir=$(pnpm josh lane:open 1490)` is what a caller needs and a refusal is an empty capture beside
// a non-zero exit. The other three follow the contract `run:hold` and `epic:next` set: a token per
// line on standard output, every explanation on standard error.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const SINGLE_ARGUMENT = 1
const ISSUE_AND_PATH_ARGUMENTS = 2
const ALL_FLAG = '--all'
const NONE_TOKEN = 'none'
const ISSUE_NUMBER_PATTERN = /^[1-9]\d*$/u

const USAGE = [
	'Usage: josh lane:open <issue-number>',
	'       josh lane:close <issue-number> | josh lane:close --all',
	'       josh lane:list',
	'       josh lane:prune',
	'       josh lane:output <issue-number> [<path>]',
].join('\n')

type Handler = (rest: ReadonlyArray<string>) => Promise<number>

function report_usage(): number {
	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

function parse_lane_issue(value: string | undefined): string | undefined {
	if (value === undefined) return undefined

	return ISSUE_NUMBER_PATTERN.test(value) ? value : undefined
}

function parse_issue(rest: ReadonlyArray<string>): string | undefined {
	if (rest.length > SINGLE_ARGUMENT) return undefined

	return parse_lane_issue(rest[0])
}

// The two refusals name what to type next, because both are states a person recovers from rather
// than reports: one lane is already there, or every index is spoken for.
function refusal_message(outcome: Exclude<OpenOutcome, { kind: 'opened' }>): string {
	if (outcome.kind === 'full') {
		return `All ${String(lane_seed_policy.LAST_LANE_SEAT)} lane seats are taken. Run \`pnpm josh lane:list\` to see them and \`pnpm josh lane:close <issue-number>\` to free one.`
	}

	return `A lane for #${outcome.lane.issue} is already open at ${outcome.lane.directory}. Run \`pnpm josh lane:close ${outcome.lane.issue}\` before opening it again.`
}

function report_open(outcome: OpenOutcome): number {
	if (outcome.kind !== 'opened') {
		console.error(refusal_message(outcome))

		return FAILURE_EXIT_CODE
	}

	console.error(lane_report.describe_opened(outcome.lane))
	console.info(outcome.lane.directory)

	return SUCCESS_EXIT_CODE
}

// One token per closed lane, `none` when there was nothing to close — so a caller sweeping up after
// an interruption can branch on the output without reading the prose.
function report_issues(issues: ReadonlyArray<string>): number {
	console.info(issues.length === 0 ? NONE_TOKEN : issues.join('\n'))

	return SUCCESS_EXIT_CODE
}

// A close that left something behind exits non-zero and names it. Reported as a success, it would
// send the caller to the next `lane:open`, which then fails on git's own message about a branch that
// still exists.
function report_close(outcome: CloseOutcome): number {
	if (outcome.kind !== 'incomplete') {
		return report_issues(outcome.kind === 'closed' ? [outcome.issue] : [])
	}

	console.error(
		`Closing the lane for #${outcome.issue} left this behind: ${outcome.left_behind.join(', ')}. Remove it and run \`pnpm josh lane:close ${outcome.issue}\` again.`,
	)

	return FAILURE_EXIT_CODE
}

// The closed lanes still go to standard output, because a sweep that failed on one of them has
// closed the rest and the caller has to know which.
function report_sweep(outcome: SweepOutcome): number {
	const code = report_issues(outcome.closed)

	if (outcome.failed.length === 0) return code

	const named = outcome.failed.map((issue) => `#${issue}`).join(', ')

	// `lane:list` reads git's work trees, and the usual survivor is a branch whose work tree is
	// already gone — which that listing cannot show. Closing each one again is what names it.
	console.error(
		`These lanes could not be closed: ${named}. Run \`pnpm josh lane:close <issue-number>\` on each to see what is left of it.`,
	)

	return FAILURE_EXIT_CODE
}

// `none` on standard output for the empty case as well, so `lane:list` keeps the contract the rest
// of the commands follow — the prose belongs on standard error with every other explanation.
function report_lanes(lanes: ReadonlyArray<LaneInfo>): number {
	if (lanes.length === 0) console.error(lane_report.NO_LANES)

	console.info(lanes.length === 0 ? NONE_TOKEN : lane_report.describe_lanes(lanes))

	return SUCCESS_EXIT_CODE
}

async function open_command(rest: ReadonlyArray<string>): Promise<number> {
	const issue = parse_issue(rest)

	if (issue === undefined) return report_usage()

	return report_open(await lane_open.open_lane(issue))
}

async function close_command(rest: ReadonlyArray<string>): Promise<number> {
	if (rest[0] === ALL_FLAG && rest.length === SINGLE_ARGUMENT) {
		return report_sweep(await lane_close.close_all_lanes())
	}

	const issue = parse_issue(rest)

	if (issue === undefined) return report_usage()

	return report_close(await lane_close.close_lane(issue))
}

async function list_command(rest: ReadonlyArray<string>): Promise<number> {
	if (rest.length > 0) return report_usage()

	return report_lanes(await lane_registry.list_lanes())
}

async function prune_command(rest: ReadonlyArray<string>): Promise<number> {
	if (rest.length > 0) return report_usage()

	return report_sweep(await lane_close.prune_lanes())
}

// The recorded path goes to standard output on both arms, so
// `unit_output=$(pnpm josh lane:output <N>) && pnpm josh run:liveness <N> --output "$unit_output"`
// works in a session that opened the lane and in one that never saw it alike. **The `&&` rather than
// a substitution inside the argument**: a substitution discards the exit status, so the `none` below
// would reach `--output` as a relative path and poll `undetermined` for ever.
function report_record(outcome: RecordOutcome, issue: string): number {
	if (outcome.kind !== 'recorded') {
		console.error(lane_output.describe_refusal(outcome, issue))

		return FAILURE_EXIT_CODE
	}

	console.info(outcome.output)

	return SUCCESS_EXIT_CODE
}

// `none` for a lane that records nothing yet — the same token `lane:list` and `lane:close` print for
// an empty answer — but with a **non-zero** exit, unlike either of those. The reader here is a
// command substitution, and `--output none` is a relative path `run:liveness` answers `undetermined`
// for: polled that way a lane says "could not read" for ever rather than "the record is missing". A
// non-zero exit is what stops the `&&` in the documented one-liner before it gets there.
function report_output(outcome: ReadOutcome, issue: string): number {
	if (outcome.kind === 'no-lane') {
		console.error(lane_output.describe_refusal(outcome, issue))

		return FAILURE_EXIT_CODE
	}

	if (outcome.kind === 'none') {
		console.error(lane_output.NO_OUTPUT)
		console.info(NONE_TOKEN)

		return FAILURE_EXIT_CODE
	}

	console.info(outcome.output)

	return SUCCESS_EXIT_CODE
}

async function output_command(rest: ReadonlyArray<string>): Promise<number> {
	const [first, second] = rest
	const issue = parse_lane_issue(first)

	if (issue === undefined || rest.length > ISSUE_AND_PATH_ARGUMENTS) return report_usage()

	if (second === undefined) return report_output(await lane_output.read_output(issue), issue)

	return report_record(await lane_output.record_output(issue, second), issue)
}

const HANDLERS: Record<string, Handler> = {
	open: open_command,
	close: close_command,
	list: list_command,
	prune: prune_command,
	output: output_command,
}

async function dispatch(argv: ReadonlyArray<string>): Promise<number> {
	const [verb, ...rest] = argv
	const handler = verb === undefined ? undefined : HANDLERS[verb]

	if (handler === undefined) return report_usage()

	return await handler(rest)
}

// A git failure — no repository, a path a work tree cannot be created at — is reported and exits
// non-zero rather than throwing a stack trace at a caller that is capturing standard output.
async function run(argv: ReadonlyArray<string>): Promise<number> {
	try {
		return await dispatch(argv)
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))

		return FAILURE_EXIT_CODE
	}
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const lane_cli = {
	ALL_FLAG,
	NONE_TOKEN,
	USAGE,
	main,
	parse_issue,
	parse_lane_issue,
	refusal_message,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { lane_cli }
