#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { backlog_preflight } from '#scripts/backlog/backlog-preflight'
import { backlogrun_launch } from '#scripts/backlog/backlogrun-launch'
import { cost_cli } from '#scripts/cost-runtime/cost-cli'
import { cost_verdict } from '#scripts/cost-runtime/cost-verdict'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_cli_fault } from '#scripts/run/run-cli-fault'
import { run_headless } from '#scripts/run/run-headless'
import {
	run_carry,
	type CarryClaim,
	type CarryClaimRequest,
	type CarryRead,
	type RunCarry,
} from './run-carry'
import { run_carry_args, type CountRequest, type Request } from './run-carry-args'
import { run_carry_conversation } from './run-carry-conversation'
import { run_carry_end } from './run-carry-end'

// `josh run:carry` — the record that carries one invocation's budget across its own session cuts.
// A `backlogrun` begins it, counts a merge and a filing into it, marks each
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
const NONE_VERDICT = 'none'
const UNREADABLE_VERDICT = 'unreadable'
const MISMATCH_VERDICT = 'mismatch'
const BUSY_VERDICT = 'busy'
const STANDING_VERDICT = 'standing'
const UNKNOWN_VERDICT = 'unknown'
// The launched parent, over the record its launch already handed to the supervisor.
const DRIVING_VERDICT = 'driving'
const DRIVING_MESSAGE =
	'The supervisor `josh backlogrun` started is already driving this run, so this session took no record. Report the plan and settle every `needs-decision` issue, then end the turn — no `run:step` hand-off.'
const COMMAND = 'run:carry'
// The invocation has taken its maximum cuts. A benign, non-failing refusal:
// the run carries on uncut rather than paying a cold preamble the accumulation it would shed no longer
// covers, exactly as an under-threshold pre-gate cut carries on to the gate.
const CAPPED_VERDICT = 'capped'
// The asking session is over the shared context-cut threshold, so nothing was claimed.
const OVER_VERDICT = 'over'
const NO_CUTS = 0

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
	// there — which of a `backlogrun`'s named issues are still outstanding — is determined by two fields
	// of the record it is already printing. A budget-only `backlogrun` names no issues, so the value is
	// `undefined` and `JSON.stringify` drops the key entirely.
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

function report_read(read: CarryRead, is_json: boolean): number {
	if (read.kind === 'none') return report(NONE_VERDICT, undefined, is_json, SUCCESS_EXIT_CODE)

	if (read.kind === 'unreadable') return report_unreadable(is_json)

	return report_carry(CARRIED_VERDICT, read.carry, is_json)
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
// standing until a person carries or discards it; `resumed` is reached only where the run itself declared the
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

// When the run began: the moment `josh backlogrun` launched this owner, so the clock `run:board` was
// already counting from does not restart at the claim; `undefined` — now — for every other run.
async function launch_start(request: CarryClaimRequest): Promise<Date | undefined> {
	const directory = await run_carry.repository_directory()

	if (directory === undefined) return undefined

	return backlogrun_launch.started_for(directory, request.owner.pid)
}

// A run that began is planning, which is what its board says until the supervisor takes it over.
async function start_fresh(
	target: string,
	request: CarryClaimRequest,
	is_json: boolean,
): Promise<number> {
	const started = await launch_start(request)
	const carry = run_carry.begin_carry(target, request.invocation, request.owner, started)

	if (carry === undefined) return report_lost(is_json)

	await run_event_setup.emit(run_event_setup.STAGE.PLANNING)

	return report_carry(BEGAN_VERDICT, carry, is_json)
}

// The parent `josh backlogrun` launched, meeting the record its preflight handed to the supervisor:
// the loop is already driven, so this parent reports the plan and settles `needs-decision` beside the
// lanes, and takes nothing (`backlog-preflight.ts`).
async function report_carried(
	target: string,
	carry: RunCarry,
	request: CarryClaimRequest,
	is_json: boolean,
): Promise<number> {
	const directory = await run_carry.repository_directory()
	const is_driven =
		directory !== undefined && backlog_preflight.is_driven_for(directory, carry, request.owner)

	if (!is_driven || carry.invocation !== request.invocation) {
		return report_claim(target, carry, request, is_json)
	}

	console.error(DRIVING_MESSAGE)

	return report(DRIVING_VERDICT, carry, is_json, SUCCESS_EXIT_CODE)
}

// **A standing record is never replaced, and never resumed into by something else.** Replacing one
// would restart the budget the cut exists to carry, and resuming into one would put two parents on a
// single budget. Its age changes none of that: a record is replaced by nothing but a person's `--end`.
async function begin(
	target: string,
	request: CarryClaimRequest,
	is_json: boolean,
): Promise<number> {
	const read = run_carry.read_carry(target)

	if (read.kind === 'unreadable') return report_unreadable(is_json)

	if (read.kind === 'carried') return await report_carried(target, read.carry, request, is_json)

	return await start_fresh(target, request, is_json)
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

	return report_claim(target, read.carry, request, is_json)
}

// **A session already over the shared cut threshold claims nothing**: a `backlogrun` parent that has
// taken its cut could otherwise retype the keyword in the same conversation and be answered `resumed`
// by its own hand-off. The verdict is `pnpm josh cost --cut`'s, so no second threshold exists; only a
// measured `over` refuses, because a provider with no transcript cannot be priced at all.
function report_over(is_json: boolean): number {
	console.error(
		'This session is over the shared context-cut threshold (`pnpm josh cost --cut` answers `over`), so no run was begun or resumed here. End this conversation and type the invocation again in a fresh session.',
	)

	return report(OVER_VERDICT, undefined, is_json, FAILURE_EXIT_CODE)
}

async function claim_record(
	target: string,
	request: CarryClaimRequest,
	is_json: boolean,
): Promise<number> {
	if (cost_cli.session_verdict() === cost_verdict.OVER_VERDICT) return report_over(is_json)

	if (request.is_adoption) return adopt(target, request, is_json)

	return await begin(target, request, is_json)
}

// The record is no longer this session's to advance — handed off at a cut, or taken over by a live
// successor. It is a refusal exit, said without applying the change.
function report_count_refused(carry: RunCarry, is_json: boolean): number {
	console.error(run_carry.count_refused_message(carry))

	return report(BUSY_VERDICT, carry, is_json, FAILURE_EXIT_CODE)
}

// The retrospective's result on the run's event stream, so a run that filed zero improvements reads
// apart from one whose retrospective never ran. It rides the `--retrospective` mark rather than a call
// of its own, so closing the retrospective and recording what it found are one action; the emit is best-effort, the same contract every other append on this stream keeps, and it
// happens only after the mark applied — a refused count records nothing.
async function record_retrospective(request: CountRequest): Promise<void> {
	if (request.summary === undefined) return

	await run_event_stream_emit.emit(run_event_stream.EVENT_KIND.RETROSPECTIVE, request.summary)
}

// A cut count is the one increment with a ceiling; a merge or a filing has
// none. `--cut` sets `cuts` to one, so a positive count is what marks this count a cut.
function is_cut_count(request: CountRequest): boolean {
	return (request.change.cuts ?? NO_CUTS) > NO_CUTS
}

// The cut cap is reached, so the cut is refused without applying it — the run carries on uncut. Said as
// a benign verdict rather than a failure, so a loop reads `capped` and continues rather than stopping.
function report_cut_capped(carry: RunCarry, is_json: boolean): number {
	console.error(
		`Cut cap reached (${String(run_carry.MAX_CUTS)} cuts); nothing was counted and the run carries on uncut.`,
	)

	return report(CAPPED_VERDICT, carry, is_json, SUCCESS_EXIT_CODE)
}

// The refusals read before a count is applied: a record this session no longer owns (handed off or
// taken over) keeps a single writer across a cut, and a cut past the cap carries on uncut. `undefined`
// when neither applies, so the count lands.
function blocked_count(
	carry: RunCarry,
	request: CountRequest,
	is_json: boolean,
): number | undefined {
	if (run_carry.is_count_refused(carry, request.owner)) return report_count_refused(carry, is_json)

	if (is_cut_count(request) && run_headless.is_cut_capped(carry)) {
		return report_cut_capped(carry, is_json)
	}

	return undefined
}

// A count against a record that is not there is `none` and exits non-zero: the loop believed it was
// carrying a budget and it was not, and a silent zero would let the run keep its own tally instead. A
// count against a record this session no longer owns is refused, and a cut past the cap carries on
// uncut, both before the change is applied.
async function count(
	target: string,
	read: CarryRead,
	request: CountRequest,
	is_json: boolean,
): Promise<number> {
	if (read.kind === 'none') return report(NONE_VERDICT, undefined, is_json, FAILURE_EXIT_CODE)

	if (read.kind === 'unreadable') return report_unreadable(is_json)

	const blocked = blocked_count(read.carry, request, is_json)

	if (blocked !== undefined) return blocked

	const owned = run_carry_conversation.reclaim_owner(read.carry, request.owner)
	const carry = run_carry.apply_change(target, owned, request.change)

	await record_retrospective(request)

	return report_carry(COUNTED_VERDICT, carry, is_json)
}

async function finish(
	directory: string,
	stopped: string | undefined,
	is_json: boolean,
): Promise<number> {
	const read = await run_carry_end.end_run(directory, { stopped, is_announced: true })

	if (read.kind === 'none') return report(NONE_VERDICT, undefined, is_json, SUCCESS_EXIT_CODE)

	if (read.kind === 'unreadable') {
		return report(ENDED_VERDICT, undefined, is_json, SUCCESS_EXIT_CODE)
	}

	return report_carry(ENDED_VERDICT, read.carry, is_json)
}

async function act(
	target: string,
	request: Exclude<Request, { kind: 'end' }>,
	is_json: boolean,
): Promise<number> {
	if (request.kind === 'claim') return await claim_record(target, request.claim, is_json)

	const read = run_carry.read_carry(target)

	if (request.kind === 'read') return report_read(read, is_json)

	return await count(target, read, request, is_json)
}

// `unknown` with the reason it was answered: nothing was established, so nothing may be concluded.
function report_unknown(message: string, is_json: boolean): number {
	console.error(message)

	return report(UNKNOWN_VERDICT, undefined, is_json, FAILURE_EXIT_CODE)
}

async function answer(request: Request, is_json: boolean): Promise<number> {
	const directory = await run_cli_fault.directory_of(COMMAND, run_carry.repository_directory)

	if (directory === undefined) return report_unknown(run_carry.unknown_message(), is_json)

	if (request.kind === 'end') return await finish(directory, request.stopped, is_json)

	return await act(run_carry.carry_path(directory), request, is_json)
}

function refuse(): number {
	console.error(run_carry_args.USAGE)

	return FAILURE_EXIT_CODE
}

// Every path out of here prints exactly one token, including the ones nobody planned: an empty
// standard output matches none of the verdicts, which a loop reads as "nothing to carry" before
// starting a second budget over the first one's. The token stays `unknown`, and the failure says what
// it was rather than borrowing the unreadable-git-directory message.
async function run(argv: ReadonlyArray<string>): Promise<number> {
	const values = run_carry_args.read_arguments(argv)

	if (values === undefined) return refuse()

	const request = run_carry_args.to_request(values)

	if (request === undefined) return refuse()

	try {
		return await answer(request, values.json === true)
	} catch (error) {
		return report_unknown(run_cli_fault.message(COMMAND, error), values.json === true)
	}
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_carry_cli = {
	BEGAN_VERDICT,
	BUSY_VERDICT,
	CAPPED_VERDICT,
	CARRIED_VERDICT,
	COUNTED_VERDICT,
	ENDED_VERDICT,
	MISMATCH_VERDICT,
	NONE_VERDICT,
	OVER_VERDICT,
	RESUMED_VERDICT,
	STANDING_VERDICT,
	UNKNOWN_VERDICT,
	// Re-exported rather than restated: the usage line belongs to the half that parses, and a second
	// copy of it here would drift from the flags it describes.
	USAGE: run_carry_args.USAGE,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_carry_cli }
