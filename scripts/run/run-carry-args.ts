import { parseArgs } from 'node:util'
import { run_carry, type CarryChange, type CarryClaimRequest, type CarryOwner } from './run-carry'
import { run_issue_number } from './run-issue-number'

// The argument half of `josh run:carry`. It sat inside `run-carry-cli.ts` until the ownership answers
// joshuafolkken/kit#1722 added took that file to 96% of the 300-line limit, and the seam it split on
// was already there: everything here turns `argv` into one `Request` and reads no record, while
// everything left there acts on a record and prints. Nothing about the behavior moved with it.

const NO_INCREMENT = 0
const ONE_CUT = 1
// The four request groups below are mutually exclusive, so more than one of them named in a single
// invocation is a usage error rather than an order to guess.
const ONE_GROUP = 1
const COUNT_PATTERN = /^\d+$/u
const EMPTY_INVOCATION = ''
// A pid below this addresses a process group rather than a process, which `process-identity.ts`
// rejects on the read side. Refused here too, so a record never records an owner nothing can be.
const MIN_PID = 1
// `--owner` is written inside the two claiming alternatives rather than after the whole list, because
// those are the only two that read it: `--end` accepts it and ignores it, and a usage line that
// offered it there would be promising an ownership check nothing performs.
const USAGE =
	'Usage: josh run:carry [--json] | --begin <invocation> [--owner <pid>] | --resume <invocation> [--owner <pid>] | --cut | --merged <count> | --filed <count> | --done <issue> | --end'

const OPTIONS = {
	begin: { type: 'string' },
	cut: { type: 'boolean' },
	done: { type: 'string' },
	end: { type: 'boolean' },
	filed: { type: 'string' },
	json: { type: 'boolean' },
	merged: { type: 'string' },
	owner: { type: 'string' },
	resume: { type: 'string' },
} as const

type OptionName = keyof typeof OPTIONS
type ParsedValues = Partial<Record<OptionName, string | boolean>>
// What `parseArgs` hands back for one option: the flag's own type, or nothing where it was not named.
type OptionValue = string | boolean | undefined

type Request =
	| { kind: 'read' }
	| { kind: 'claim'; claim: CarryClaimRequest }
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

function text_of(value: OptionValue): string | undefined {
	return typeof value === 'string' ? value : undefined
}

// Absent is zero; present but not a count is `undefined`, which invalidates the whole invocation
// rather than quietly counting nothing.
function to_count(value: OptionValue): number | undefined {
	const text = text_of(value)

	if (text === undefined) return NO_INCREMENT

	return COUNT_PATTERN.test(text) ? Number(text) : undefined
}

// **`--done` names an issue, so it is checked as one and not as a count.** The shape is
// `run-issue-number.ts`'s, which already refuses `0` and a leading zero — the same rule the `run:*`
// commands interpolate a number under, imported rather than restated. Absent is an empty object rather
// than a zero: there is no issue to record, which is a different fact from recording issue zero. A
// present-but-malformed value invalidates the whole invocation, exactly as a bad `--merged` does.
function to_done(value: OptionValue): Pick<CarryChange, 'done'> | undefined {
	const text = text_of(value)

	if (text === undefined) return {}

	if (!run_issue_number.ISSUE_NUMBER_PATTERN.test(text)) return undefined

	const issue = Number(text)

	// The pattern is anchored on digits and bounds nothing, so the magnitude check is separate — the
	// same shape `backlog_budget_cli.to_count` ends with. A number past the safe range would be
	// recorded as a different number and never match anything in `remaining`.
	return Number.isSafeInteger(issue) ? { done: issue } : undefined
}

function to_change(values: ParsedValues): CarryChange | undefined {
	const merged = to_count(values.merged)
	const filed = to_count(values.filed)
	const done = to_done(values.done)

	if (merged === undefined || filed === undefined || done === undefined) return undefined

	return { merged, filed, cuts: values.cut === true ? ONE_CUT : NO_INCREMENT, ...done }
}

// **A counting flag is what makes a count, never the sum of one.** `--merged 0` is a run reporting
// that a wave merged nothing, and reading it as a bare read would answer `none` with exit 0 against
// a record that is not there — the silent zero `docs/josh-commands.md` says exits 1.
function has_count(values: ParsedValues): boolean {
	return (
		values.cut === true ||
		values.merged !== undefined ||
		values.filed !== undefined ||
		values.done !== undefined
	)
}

// The four groups are mutually exclusive: `--begin` starts a run, `--resume` adopts one, `--end`
// finishes one, and the counters change one that is already there. Two groups in one invocation is a
// usage error, never a guessed order between them.
function group_count(values: ParsedValues): number {
	const groups = [
		values.begin !== undefined,
		values.resume !== undefined,
		values.end === true,
		has_count(values),
	]

	return groups.filter(Boolean).length
}

// **`--owner` is what makes liveness answerable at all.** The process that runs this command is a
// short-lived `tsx`, so its own pid says nothing about whether the run is still going; the caller
// names the process that is — its own session — and a `backlogrun` passes `--owner "$PPID"`. Absent,
// the record simply declares no owner and every standing record reads as not provably live, which
// refuses rather than resumes.
function to_owner(value: OptionValue): CarryOwner | undefined {
	const text = text_of(value)

	if (text === undefined) return run_carry.NO_OWNER

	if (!COUNT_PATTERN.test(text)) return undefined

	const pid = Number(text)

	return pid < MIN_PID ? undefined : run_carry.owner_of(pid)
}

// The counting group, split out so the shape below stays a flat list of exits.
function to_count_request(values: ParsedValues): Request | undefined {
	const change = to_change(values)

	if (change === undefined) return undefined

	return { kind: 'count', change }
}

// `--begin ""` is a loop whose invocation variable was unset. A record named by nothing is one every
// other empty `--begin` then reads as its own, which is the cross-run inheritance `classify_claim`
// exists to refuse — so it is a usage error rather than a record.
function to_claim_request(
	invocation: string,
	owner: CarryOwner,
	is_adoption: boolean,
): Request | undefined {
	if (invocation === EMPTY_INVOCATION) return undefined

	return { kind: 'claim', claim: { invocation, owner, is_adoption } }
}

function to_other_request(values: ParsedValues): Request | undefined {
	if (values.end === true) return END_REQUEST

	return has_count(values) ? to_count_request(values) : READ_REQUEST
}

function to_named_request(values: ParsedValues, owner: CarryOwner): Request | undefined {
	const begun = text_of(values.begin)

	if (begun !== undefined) return to_claim_request(begun, owner, false)

	const adopted = text_of(values.resume)

	if (adopted !== undefined) return to_claim_request(adopted, owner, true)

	return to_other_request(values)
}

function to_request(values: ParsedValues): Request | undefined {
	if (group_count(values) > ONE_GROUP) return undefined

	const owner = to_owner(values.owner)

	if (owner === undefined) return undefined

	return to_named_request(values, owner)
}

const run_carry_args = {
	OPTIONS,
	USAGE,
	read_arguments,
	to_request,
}

export type { OptionValue, ParsedValues, Request }
export { run_carry_args }
