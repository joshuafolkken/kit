#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { run_carry, type CarryChange, type CarryRead, type RunCarry } from './run-carry'

// `josh run:carry` — the record that carries one invocation's budget across its own session cuts
// (joshuafolkken/kit#1714). A `backlogrun` begins it, counts a merge and a filing into it, marks each
// cut, and ends it; a session that resumes after a cut reads the same budget back rather than
// starting a new one.
//
// The contract is `run:hold`'s: **standard output carries exactly one token** and every explanation
// goes to standard error, so `answer=$(pnpm josh run:carry --begin "backlogrun --max 5")` captures
// something a loop can branch on. `--json` is the one exception, and it is still one line: the whole
// record has to reach a resumed session, and prose on standard error cannot be read back.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const NO_INCREMENT = 0
const ONE_CUT = 1
// The three request groups below are mutually exclusive, so more than one of them named in a single
// invocation is a usage error rather than an order to guess.
const ONE_GROUP = 1
const COUNT_PATTERN = /^\d+$/u
const EMPTY_INVOCATION = ''
const USAGE =
	'Usage: josh run:carry [--json] | --begin <invocation> | --cut | --merged <count> | --filed <count> | --end'

const BEGAN_VERDICT = 'began'
const RESUMED_VERDICT = 'resumed'
const CARRIED_VERDICT = 'carried'
const COUNTED_VERDICT = 'counted'
const ENDED_VERDICT = 'ended'
const EXPIRED_VERDICT = 'expired'
const NONE_VERDICT = 'none'
const UNREADABLE_VERDICT = 'unreadable'
const MISMATCH_VERDICT = 'mismatch'
const UNKNOWN_VERDICT = 'unknown'

const OPTIONS = {
	begin: { type: 'string' },
	cut: { type: 'boolean' },
	end: { type: 'boolean' },
	filed: { type: 'string' },
	json: { type: 'boolean' },
	merged: { type: 'string' },
} as const

type OptionName = keyof typeof OPTIONS
type ParsedValues = Partial<Record<OptionName, string | boolean>>

type Request =
	| { kind: 'read' }
	| { kind: 'begin'; invocation: string }
	| { kind: 'count'; change: CarryChange }
	| { kind: 'end' }

const READ_REQUEST: Request = { kind: 'read' }
const END_REQUEST: Request = { kind: 'end' }

function read_arguments(argv: ReadonlyArray<string>): ParsedValues | undefined {
	try {
		return parseArgs({ args: [...argv], options: OPTIONS, strict: true }).values
	} catch {
		return undefined
	}
}

function text_of(value: string | boolean | undefined): string | undefined {
	return typeof value === 'string' ? value : undefined
}

// Absent is zero; present but not a count is `undefined`, which invalidates the whole invocation
// rather than quietly counting nothing.
function to_count(value: string | boolean | undefined): number | undefined {
	const text = text_of(value)

	if (text === undefined) return NO_INCREMENT

	return COUNT_PATTERN.test(text) ? Number(text) : undefined
}

function to_change(values: ParsedValues): CarryChange | undefined {
	const merged = to_count(values.merged)
	const filed = to_count(values.filed)

	if (merged === undefined || filed === undefined) return undefined

	return { merged, filed, cuts: values.cut === true ? ONE_CUT : NO_INCREMENT }
}

// **A counting flag is what makes a count, never the sum of one.** `--merged 0` is a run reporting
// that a wave merged nothing, and reading it as a bare read would answer `none` with exit 0 against
// a record that is not there — the silent zero `docs/josh-commands.md` says exits 1.
function has_count(values: ParsedValues): boolean {
	return values.cut === true || values.merged !== undefined || values.filed !== undefined
}

// The three groups are mutually exclusive: `--begin` starts a run, `--end` finishes one, and the
// counters change one that is already there. Two groups in one invocation is a usage error, never a
// guessed order between them.
function group_count(values: ParsedValues): number {
	const groups = [values.begin !== undefined, values.end === true, has_count(values)]

	return groups.filter(Boolean).length
}

// The counting group, split out so the shape below stays a flat list of exits.
function to_count_request(values: ParsedValues): Request | undefined {
	const change = to_change(values)

	if (change === undefined) return undefined

	return { kind: 'count', change }
}

// `--begin ""` is a loop whose invocation variable was unset. A record named by nothing is one every
// other empty `--begin` then resumes into, which is the cross-run inheritance `resume` below exists
// to refuse — so it is a usage error rather than a record.
function to_begin_request(invocation: string): Request | undefined {
	return invocation === EMPTY_INVOCATION ? undefined : { kind: 'begin', invocation }
}

function to_request(values: ParsedValues): Request | undefined {
	if (group_count(values) > ONE_GROUP) return undefined

	const invocation = text_of(values.begin)

	if (invocation !== undefined) return to_begin_request(invocation)

	if (values.end === true) return END_REQUEST

	return has_count(values) ? to_count_request(values) : READ_REQUEST
}

function report(
	verdict: string,
	carry: RunCarry | undefined,
	is_json: boolean,
	code: number,
): number {
	console.info(is_json ? JSON.stringify({ verdict, carry }) : verdict)

	return code
}

function report_carry(verdict: string, carry: RunCarry, is_json: boolean): number {
	if (!is_json) console.error(run_carry.describe_carry(carry))

	return report(verdict, carry, is_json, SUCCESS_EXIT_CODE)
}

function report_unreadable(is_json: boolean): number {
	console.error(run_carry.unreadable_message())

	return report(UNREADABLE_VERDICT, undefined, is_json, FAILURE_EXIT_CODE)
}

function report_expired(carry: RunCarry, is_json: boolean): number {
	console.error(run_carry.expired_message(carry))

	return report_carry(EXPIRED_VERDICT, carry, is_json)
}

function report_read(read: CarryRead, is_json: boolean): number {
	if (read.kind === 'none') return report(NONE_VERDICT, undefined, is_json, SUCCESS_EXIT_CODE)

	if (read.kind === 'unreadable') return report_unreadable(is_json)

	if (read.kind === 'expired') return report_expired(read.carry, is_json)

	return report_carry(CARRIED_VERDICT, read.carry, is_json)
}

// A live record belonging to a **different** invocation is not this run's budget to spend. `--end`
// is only reached on the clean-finish path, so a run that crashed or stopped on a guard leaves its
// record standing for up to the whole-run bound; answering `resumed` there would hand the new
// invocation the dead one's `--max`, its spent counts and a `started_at` already hours old.
function resume(carry: RunCarry, invocation: string, is_json: boolean): number {
	if (carry.invocation === invocation) return report_carry(RESUMED_VERDICT, carry, is_json)

	console.error(run_carry.mismatch_message(carry, invocation))

	return report(MISMATCH_VERDICT, carry, is_json, FAILURE_EXIT_CODE)
}

// **A live record is never replaced.** Replacing one would restart the budget the cut exists to
// carry, which is the whole defect this command was written for. An expired one is replaced, because
// its run has spent the whole-run bound and a person typing the keyword again is starting a new run.
function begin(target: string, invocation: string, is_json: boolean): number {
	const read = run_carry.read_carry(target)

	if (read.kind === 'unreadable') return report_unreadable(is_json)

	if (read.kind === 'carried') return resume(read.carry, invocation, is_json)

	if (read.kind === 'expired') console.error(run_carry.expired_message(read.carry))

	return report_carry(BEGAN_VERDICT, run_carry.begin_carry(target, invocation), is_json)
}

// A count against a record that is not there is `none` and exits non-zero: the loop believed it was
// carrying a budget and it was not, and a silent zero would let the run keep its own tally instead.
function count(target: string, read: CarryRead, change: CarryChange, is_json: boolean): number {
	if (read.kind === 'none') return report(NONE_VERDICT, undefined, is_json, FAILURE_EXIT_CODE)

	if (read.kind === 'unreadable') return report_unreadable(is_json)

	const carry = run_carry.apply_change(target, read.carry, change)

	return read.kind === 'expired'
		? report_expired(carry, is_json)
		: report_carry(COUNTED_VERDICT, carry, is_json)
}

function finish(target: string, is_json: boolean): number {
	const read = run_carry.read_carry(target)

	run_carry.end_carry(target)

	if (read.kind === 'none') return report(NONE_VERDICT, undefined, is_json, SUCCESS_EXIT_CODE)

	if (read.kind === 'unreadable') {
		return report(ENDED_VERDICT, undefined, is_json, SUCCESS_EXIT_CODE)
	}

	return report_carry(ENDED_VERDICT, read.carry, is_json)
}

function act(target: string, request: Request, is_json: boolean): number {
	if (request.kind === 'begin') return begin(target, request.invocation, is_json)

	if (request.kind === 'end') return finish(target, is_json)

	const read = run_carry.read_carry(target)

	if (request.kind === 'read') return report_read(read, is_json)

	return count(target, read, request.change, is_json)
}

function report_unknown(is_json: boolean): number {
	console.error(run_carry.unknown_message())

	return report(UNKNOWN_VERDICT, undefined, is_json, FAILURE_EXIT_CODE)
}

async function answer(request: Request, is_json: boolean): Promise<number> {
	const directory = await run_carry.repository_directory()

	if (directory === undefined) return report_unknown(is_json)

	return act(run_carry.carry_path(directory), request, is_json)
}

function refuse(): number {
	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

// Every path out of here prints exactly one token, including the ones nobody planned: an empty
// standard output matches none of the verdicts, which a loop reads as "nothing to carry" before
// starting a second budget over the first one's.
async function run(argv: ReadonlyArray<string>): Promise<number> {
	const values = read_arguments(argv)

	if (values === undefined) return refuse()

	const request = to_request(values)

	if (request === undefined) return refuse()

	try {
		return await answer(request, values.json === true)
	} catch {
		return report_unknown(values.json === true)
	}
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_carry_cli = {
	BEGAN_VERDICT,
	CARRIED_VERDICT,
	COUNTED_VERDICT,
	ENDED_VERDICT,
	EXPIRED_VERDICT,
	MISMATCH_VERDICT,
	NONE_VERDICT,
	OPTIONS,
	RESUMED_VERDICT,
	UNKNOWN_VERDICT,
	UNREADABLE_VERDICT,
	USAGE,
	main,
	read_arguments,
	run,
	to_request,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export type { ParsedValues, Request }
export { run_carry_cli }
