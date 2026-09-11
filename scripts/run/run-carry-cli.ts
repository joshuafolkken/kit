#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import {
	run_carry,
	type CarryChange,
	type CarryClaim,
	type CarryClaimRequest,
	type CarryRead,
	type RunCarry,
} from './run-carry'
import { run_carry_args, type Request } from './run-carry-args'

// `josh run:carry` — the record that carries one invocation's budget across its own session cuts
// (joshuafolkken/kit#1714). A `backlogrun` begins it, counts a merge and a filing into it, marks each
// cut, and ends it; a session that resumes after a cut reads the same budget back rather than
// starting a new one. **Turning `argv` into a request is `run-carry-args.ts`'s**; what is here acts
// on the record and prints.
//
// The contract is `run:hold`'s: **standard output carries exactly one token** and every explanation
// goes to standard error, so `answer=$(pnpm josh run:carry --begin "backlogrun --max 5")` captures
// something a loop can branch on. `--json` is the one exception, and it is still one line: the whole
// record has to reach a resumed session, and prose on standard error cannot be read back.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const BEGAN_VERDICT = 'began'
const RESUMED_VERDICT = 'resumed'
const CARRIED_VERDICT = 'carried'
const COUNTED_VERDICT = 'counted'
const ENDED_VERDICT = 'ended'
const EXPIRED_VERDICT = 'expired'
const NONE_VERDICT = 'none'
const UNREADABLE_VERDICT = 'unreadable'
const MISMATCH_VERDICT = 'mismatch'
const BUSY_VERDICT = 'busy'
const STANDING_VERDICT = 'standing'
const UNKNOWN_VERDICT = 'unknown'

const CLAIM_VERDICTS: Record<CarryClaim, string> = {
	busy: BUSY_VERDICT,
	mismatch: MISMATCH_VERDICT,
	resume: RESUMED_VERDICT,
	standing: STANDING_VERDICT,
}

function report(
	verdict: string,
	carry: RunCarry | undefined,
	is_json: boolean,
	code: number,
): number {
	// **`remaining` rides along with the record rather than behind a flag of its own.** `--json` is
	// already the one answer a resumed session reads back in full, and the question it has to answer
	// there — which issues of a `queue` are still outstanding — is determined by two fields of the
	// record it is already printing (joshuafolkken/kit#1774). A `backlogrun` record has no issue list,
	// so the value is `undefined` and `JSON.stringify` drops the key entirely.
	console.info(
		is_json
			? JSON.stringify({ verdict, carry, remaining: run_carry.remaining_of(carry) })
			: verdict,
	)

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

function report_busy(carry: RunCarry, is_json: boolean): number {
	console.error(run_carry.busy_message(carry))

	return report(BUSY_VERDICT, carry, is_json, FAILURE_EXIT_CODE)
}

function refusal_message(claim: CarryClaim, carry: RunCarry, invocation: string): string {
	if (claim === 'busy') return run_carry.busy_message(carry)

	if (claim === 'mismatch') return run_carry.mismatch_message(carry, invocation)

	return run_carry.standing_message(carry)
}

// The exclusive create lost to another process, which is what `busy` says. It is said without
// re-reading the record, because a record this caller does not own is not one to report the contents
// of as though it had established them.
function report_lost(is_json: boolean): number {
	console.error(run_carry.lost_message())

	return report(BUSY_VERDICT, undefined, is_json, FAILURE_EXIT_CODE)
}

// The take-over lost that same create, so another process claimed the record in between.
function report_adoption(
	target: string,
	carry: RunCarry,
	request: CarryClaimRequest,
	is_json: boolean,
): number {
	const adopted = run_carry.adopt_carry(target, carry, request.owner)

	if (adopted === undefined) return report_lost(is_json)

	return report_carry(RESUMED_VERDICT, adopted, is_json)
}

// **Whose record it is, is the classifier's answer and not this command's guess.** `--end` is only
// reached on the clean-finish path, so a run that crashed or stopped on a guard leaves its record
// standing for up to the whole-run bound; `resumed` is reached only where the run itself declared the
// cut, or where `--resume` says the reader has decided to carry it.
function report_claim(
	target: string,
	carry: RunCarry,
	request: CarryClaimRequest,
	is_json: boolean,
): number {
	const claim = run_carry.classify_claim(carry, request)

	if (claim === 'resume') return report_adoption(target, carry, request, is_json)

	console.error(refusal_message(claim, carry, request.invocation))

	return report(CLAIM_VERDICTS[claim], carry, is_json, FAILURE_EXIT_CODE)
}

function start_fresh(
	target: string,
	request: CarryClaimRequest,
	is_replacement: boolean,
	is_json: boolean,
): number {
	const carry = is_replacement
		? run_carry.replace_carry(target, request.invocation, request.owner)
		: run_carry.begin_carry(target, request.invocation, request.owner)

	if (carry === undefined) return report_lost(is_json)

	return report_carry(BEGAN_VERDICT, carry, is_json)
}

// **The bound ends *that* run, so a spent record whose owner is still running is not replaced
// either.** Replacing it would delete a live parent's budget and answer `began` — two parents on one
// record, which is the half of the defect the expiry path would otherwise have kept. Only that run,
// or a person who knows it is over, ends it.
function begin_over_expired(
	target: string,
	carry: RunCarry,
	request: CarryClaimRequest,
	is_json: boolean,
): number {
	if (run_carry.is_foreign_live_owner(carry, request.owner)) return report_busy(carry, is_json)

	// **A hand-off says the resumption *is* that run, so the spent bound is this session's too.**
	// Replaced here, the record would come back with `started_at` set to now — and `backlog:budget
	// --started` reads that field, so the 8-hour bound would restart at every cut and never end the
	// run. The answer is `expired`, and a person who really is starting a new run clears the record
	// with `--end`, which is what the expiry message says.
	if (carry.is_handed_off === true) return report_expired(carry, is_json)

	console.error(run_carry.expired_message(carry))

	return start_fresh(target, request, true, is_json)
}

// **A live record is never replaced, and never resumed into by something else.** Replacing one would
// restart the budget the cut exists to carry, and resuming into one would put two parents on a single
// budget — the two halves of the defect this command was written for. An expired one is replaced,
// because its run has spent the whole-run bound and a person typing the keyword again is starting a
// new run — unless its owner is still running, which is the case above.
function begin(target: string, request: CarryClaimRequest, is_json: boolean): number {
	const read = run_carry.read_carry(target)

	if (read.kind === 'unreadable') return report_unreadable(is_json)

	if (read.kind === 'carried') return report_claim(target, read.carry, request, is_json)

	if (read.kind === 'expired') return begin_over_expired(target, read.carry, request, is_json)

	return start_fresh(target, request, false, is_json)
}

function report_nothing_to_resume(is_json: boolean): number {
	console.error(run_carry.nothing_to_resume_message())

	return report(NONE_VERDICT, undefined, is_json, FAILURE_EXIT_CODE)
}

// `--resume` is the carry half of the answer `standing` asks for: the reader has decided the standing
// record's run is over and its budget is this session's to continue. It still refuses a live foreign
// owner, because deciding that is not the same as being allowed to.
function adopt(target: string, request: CarryClaimRequest, is_json: boolean): number {
	const read = run_carry.read_carry(target)

	if (read.kind === 'none') return report_nothing_to_resume(is_json)

	if (read.kind === 'unreadable') return report_unreadable(is_json)

	if (read.kind === 'expired') return report_expired(read.carry, is_json)

	return report_claim(target, read.carry, request, is_json)
}

function claim_record(target: string, request: CarryClaimRequest, is_json: boolean): number {
	return request.is_adoption ? adopt(target, request, is_json) : begin(target, request, is_json)
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
	if (request.kind === 'claim') return claim_record(target, request.claim, is_json)

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
	console.error(run_carry_args.USAGE)

	return FAILURE_EXIT_CODE
}

// Every path out of here prints exactly one token, including the ones nobody planned: an empty
// standard output matches none of the verdicts, which a loop reads as "nothing to carry" before
// starting a second budget over the first one's.
async function run(argv: ReadonlyArray<string>): Promise<number> {
	const values = run_carry_args.read_arguments(argv)

	if (values === undefined) return refuse()

	const request = run_carry_args.to_request(values)

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
	BUSY_VERDICT,
	CARRIED_VERDICT,
	COUNTED_VERDICT,
	ENDED_VERDICT,
	EXPIRED_VERDICT,
	MISMATCH_VERDICT,
	NONE_VERDICT,
	RESUMED_VERDICT,
	STANDING_VERDICT,
	UNKNOWN_VERDICT,
	UNREADABLE_VERDICT,
	// Re-exported rather than restated: the usage line belongs to the half that parses, and a second
	// copy of it here would drift from the flags it describes.
	USAGE: run_carry_args.USAGE,
	main,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_carry_cli }
