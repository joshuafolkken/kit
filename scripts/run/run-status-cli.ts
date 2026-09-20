#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { cost_cli, type CostVerdict } from '#scripts/cost-runtime/cost-cli'
import { issue_state_cli, type StateRead } from '#scripts/issue/issue-state-cli'
import { run_carry, type CarryRead } from './run-carry'
import { run_status, type StatusParts } from './run-status'

// `josh run:status <N>` — one call for the read-only status a run glances at (joshuafolkken/kit#2165):
// the issue's state and labels (`issue:state`), the session's hand-off verdict (`cost --cut`), and the
// invocation's carry counters (`run:carry`). Each is reused rather than reproduced, and the two async
// reads run concurrently, so three round trips become one.
//
// **Nothing here writes.** The claim `run:hold` makes and the clock mark `run:progress` records are
// deliberately out: this command answers "where does this run stand", and a status read that mutated
// the thing it read is the bug the read-only pin (`run-status-cli.test.ts`) exists to catch. The merge
// event keeps its own composite (`run:merge`), which is where the same three facts are read to *act*.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const ISSUE_NUMBER_PATTERN = /^[1-9]\d*$/u
const USAGE = 'Usage: josh run:status <issue-number> [--repo <owner/repo>]'
const CARRY_NONE_NOTE = 'no run recorded here'
const CARRY_UNREADABLE_NOTE = '(run record not bundled: unreadable)'
const CARRY_SUMMARY_NONE = 'none'
const CARRY_SUMMARY_EXPIRED = 'expired'
const CARRY_SUMMARY_UNREADABLE = 'unreadable'
const MERGED_SUFFIX = ' merged'

const OPTIONS = { repo: { type: 'string' } } as const

interface StatusRequest {
	issue_number: string
	repo?: string
}

interface StatusReads {
	state: StateRead
	carry: CarryRead
	cost: CostVerdict
}

interface ParsedArguments {
	positionals: ReadonlyArray<string>
	values: { repo?: string }
}

function read_args(argv: ReadonlyArray<string>): ParsedArguments | undefined {
	try {
		return parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true })
	} catch {
		return undefined
	}
}

// Exactly one issue number, or the call is refused: `run:status` reports one run, and a second number
// would print a second issue's state a caller reads as this run's own.
function valid_issue(positionals: ReadonlyArray<string>): string | undefined {
	const [first, ...rest] = positionals

	if (first === undefined || rest.length > 0) return undefined

	return ISSUE_NUMBER_PATTERN.test(first) ? first : undefined
}

function parse(argv: ReadonlyArray<string>): StatusRequest | undefined {
	const parsed = read_args(argv)

	if (parsed === undefined) return undefined

	const issue_number = valid_issue(parsed.positionals)

	if (issue_number === undefined) return undefined

	const { repo } = parsed.values

	return repo === undefined ? { issue_number } : { issue_number, repo }
}

// The carry record is keyed on the common git directory every lane of one repository shares, resolved
// the way `run-carry` resolves it. An unreadable git directory is reported as an unreadable record
// rather than invented as `none`, the same distinction `run-carry` keeps.
async function read_carry_record(): Promise<CarryRead> {
	const directory = await run_carry.repository_directory()

	if (directory === undefined) return { kind: 'unreadable' }

	return run_carry.read_carry(run_carry.carry_path(directory))
}

async function gather(request: StatusRequest): Promise<StatusReads> {
	const [state, carry] = await Promise.all([
		issue_state_cli.read_issue(request.issue_number, request.repo),
		read_carry_record(),
	])

	return { state, carry, cost: cost_cli.session_verdict() }
}

// One note for a read that produced nothing, naming which of the two it was — the same distinction
// `issue:state` keeps, so a bundled failure still tells a retry from an answer.
function failure_note(issue_number: string, kind: string): string {
	return `(issue #${issue_number} not bundled: ${kind})`
}

function carry_summary(carry: CarryRead): string {
	if (carry.kind === 'carried') return `${String(carry.carry.merged)}${MERGED_SUFFIX}`
	if (carry.kind === 'expired') return CARRY_SUMMARY_EXPIRED
	if (carry.kind === 'unreadable') return CARRY_SUMMARY_UNREADABLE

	return CARRY_SUMMARY_NONE
}

function carry_detail(carry: CarryRead): string {
	if (carry.kind === 'carried' || carry.kind === 'expired') {
		return run_carry.describe_carry(carry.carry)
	}

	if (carry.kind === 'unreadable') return CARRY_UNREADABLE_NOTE

	return CARRY_NONE_NOTE
}

function to_parts(issue_number: string, reads: StatusReads): StatusParts {
	const state = reads.state.kind === 'state' ? reads.state.state : undefined
	const state_failure = state === undefined ? failure_note(issue_number, reads.state.kind) : ''

	return {
		issue_number,
		state,
		state_failure,
		cost_verdict: reads.cost,
		carry_summary: carry_summary(reads.carry),
		carry_detail: carry_detail(reads.carry),
	}
}

// Non-zero when any of the three could not answer: a failed state read, an unreadable carry record, or
// a session that cannot be priced. A `none` carry is a valid answer — no run is recorded — so it is
// not a failure, exactly as `issue:state` treats a resolved state.
function exit_code(reads: StatusReads): number {
	const is_complete =
		reads.state.kind === 'state' &&
		reads.carry.kind !== 'unreadable' &&
		reads.cost !== cost_cli.UNMEASURABLE_VERDICT

	return is_complete ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const request = parse(argv)

	if (request === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const reads = await gather(request)

	console.info(run_status.format_report(to_parts(request.issue_number, reads)))

	return exit_code(reads)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_status_cli = { USAGE, parse, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_status_cli }
