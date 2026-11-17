import { lane_state } from '#scripts/lane/lane-state'
import { run_cli_fault } from '#scripts/run/run-cli-fault'
import { run_halfrun_resume } from '#scripts/run/run-halfrun-resume'
import { run_label } from '#scripts/run/run-label'
import { run_maintenance } from '#scripts/run/run-maintenance'
import { run_preflight, type PreflightDecision } from '#scripts/run/run-preflight'
import { run_prrun_resume } from '#scripts/run/run-prrun-resume'
import { run_ship_lap } from '#scripts/run/ship/run-ship-lap'
import { test_e2e_stamp } from '#scripts/test/test-e2e-stamp'
import { run_hold, type HoldRead, type RunHold } from './run-hold'
import { run_hold_adopt } from './run-hold-adopt'
import { run_hold_block } from './run-hold-block'
import {
	run_hold_request,
	type ClaimRequest,
	type HoldRequest,
	type StopKind,
	type StopRequest,
	type TakeOverRequest,
} from './run-hold-request'
import { run_stop_notify } from './run-stop-notify'

// `josh run:hold [<N>]` and `josh run:release [<N> | --force]` — the working-tree guard the typed
// entry points ask before they start.
//
// **A numbered claim asks the preflight question first**: the claim runs the check itself and hands
// back a hold only on a `clean` tree. A `reclaim` / `resume` / `park` tree is returned as that verdict
// without a record being written, and the read-only check stays re-askable — clean up what it named,
// ask `run:hold` again. The decision logic lives in `run-preflight.ts` for `run:progress` to reuse.
//
// **A release names the run it belongs to, exactly as the claim did.** The `busy` stop message tells
// a person to release when they judge a record stale — a judgement made from outside the run that
// wrote it — so an unowned release would make the guard's own recovery instruction a way to free a
// live run's tree.
//
// **It answers, so the entry point does not judge.** "This one is a small change, it will be fine" is
// a judgement made under time pressure, and it is the same shape `delegation-policy.ts` refuses to
// leave to an agent. A token on standard output is what the entry
// point obeys.
//
// The contract is `epic:next`'s: **standard output carries exactly one token** — `hold`, `busy` or
// `unknown` — and every explanation goes to standard error, so `answer=$(pnpm josh run:hold 1091)`
// captures something a loop can branch on.
//
// **A successful claim launches a detached sweep of merged residue** — `run:tidy`. After the
// claim rather than before it: the sweep may append to the primary checkout's observation ledger, and
// doing that ahead of the preflight would turn a clean primary checkout into a `reclaim`.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const {
	ADOPT_KIND,
	FORCE_RELEASE_KIND,
	HALFRUN_STOP_KIND,
	HUMAN_REVIEW_STOP_KIND,
	PRRUN_STOP_KIND,
	USAGE,
	is_stop_request,
	is_take_over_request,
	parse_request,
} = run_hold_request

const COMMAND = 'run:hold'

const HOLD_VERDICT = 'hold'
const BUSY_VERDICT = 'busy'
const UNKNOWN_VERDICT = 'unknown'
const RELEASED_VERDICT = 'released'
const NONE_VERDICT = 'none'
// The record is another run's, so nothing was removed. **It is not `none`**: a release that did not
// happen must never read to a script as a tree it has just freed.
const HELD_VERDICT = 'held'
// A stop before commit asked on a tree `josh test:e2e` has not answered green on: nothing was marked.
const E2E_OWED_VERDICT = 'e2e-owed'

// One shape for every answer that carries an explanation: the reason to standard error, the single
// token to standard output, and the exit code that says whether anything was established.
function report(message: string, verdict: string, code: number): number {
	console.error(message)
	console.info(verdict)

	return code
}

function report_busy(message: string): number {
	return report(message, BUSY_VERDICT, SUCCESS_EXIT_CODE)
}

function report_hold(): number {
	console.info(HOLD_VERDICT)

	return SUCCESS_EXIT_CODE
}

// A record already here is never overwritten by a claim: overwriting is what the guard exists to
// prevent, and the person who knows the other run has ended clears it with `run:release --force`.
function take_free_tree(target: string, request: ClaimRequest): number {
	const is_taken = run_hold.create_hold(target, request.issue, new Date(), request.mark)

	if (is_taken) return report_hold()

	return report_busy(run_hold.race_message(run_hold.read_hold(target), target))
}

// **The stale path takes the tree the same exclusive way the free path does.** Replacing an expired
// record with a plain write would tell two sessions that both found it expired that they both won —
// the race the free path guards against. Removing it first is what
// turns the expired record into a free tree; the create is what decides between the two claimants.
function replace_stale(target: string, request: ClaimRequest, hold: RunHold): number {
	console.error(run_hold.stale_message(hold))
	run_hold.release_hold(target)

	return take_free_tree(target, request)
}

// The claim on a tree nothing blocks. A `held` record that got this far is the run's own, so it is
// kept as written — its stop marks included — and answered `hold`.
function take_tree(target: string, request: ClaimRequest, read: HoldRead): number {
	if (read.kind === 'held') return report_hold()

	return read.kind === 'stale'
		? replace_stale(target, request, read.hold)
		: take_free_tree(target, request)
}

// A non-clean preflight verdict is not an error: it is an answer a loop branches on, exactly as
// `busy` is, so it prints the reason and advice the check composed and exits zero. Only an unreadable
// tree is `unknown`, and that reaches `report_unknown` through `answer`'s directory read.
function report_preflight(decision: PreflightDecision): number {
	console.error(`${decision.reason}\n${decision.advice}`)
	console.info(decision.verdict)

	return SUCCESS_EXIT_CODE
}

// **The tree is checked before it is claimed.** A numbered claim carries a child whose branch and
// pull request the check reads; a non-`clean` verdict stops the claim and is returned as-is, so no
// record is written over work a run left behind. Two claims skip it: the unnumbered `new` claim has
// no child to preflight, and a lane claim is covered by `lane:open` instead.
async function preflight_gate(issue: string, is_linked: boolean): Promise<number | undefined> {
	if (is_linked || issue === run_hold.UNNUMBERED_ISSUE) return undefined

	const decision = await run_preflight.check(issue)

	if (decision.verdict !== run_preflight.CLEAN_VERDICT) return report_preflight(decision)

	// A clean tree on the issue's own branch is a resume: the hold is taken, and the whole-gate rule is
	// still said, because nobody verified what the earlier run committed.
	if (decision.advice === run_preflight.RESUME_ADVICE) {
		console.error(`${decision.reason}\n${decision.advice}`)
	}

	return undefined
}

async function claim(target: string, request: ClaimRequest, is_linked: boolean): Promise<number> {
	const gate = await run_ship_lap.timed(
		'preflight',
		async () => await preflight_gate(request.issue, is_linked),
	)

	if (gate !== undefined) return gate

	const read = run_hold.read_hold(target)
	const blocked = await run_hold_block.blocking_message(read, request.issue)

	if (blocked !== undefined) return report_busy(blocked)

	const code = await run_ship_lap.timed('take_tree', async () => take_tree(target, request, read))

	if (code === SUCCESS_EXIT_CODE) run_maintenance.sweep()

	return code
}

function remove_record(target: string, was_present: boolean): number {
	run_hold.release_hold(target)
	console.info(was_present ? RELEASED_VERDICT : NONE_VERDICT)

	return SUCCESS_EXIT_CODE
}

function report_held(hold: RunHold): number {
	return report(run_hold.foreign_release_message(hold), HELD_VERDICT, FAILURE_EXIT_CODE)
}

// A record nothing can parse names no run, so no claimant can match it — and removing it, or marking
// a stop on it, is what these paths refuse. It answers `unknown` for the reason every other
// unreadable state here does: nothing was established, so nothing may be concluded.
function report_unreadable_record(): number {
	return report(run_hold.unreadable_message(), UNKNOWN_VERDICT, FAILURE_EXIT_CODE)
}

// **A release removes the record only where the record names the run asking**, so the `busy` stop
// message's recovery instruction cannot free a live run's tree.
function release_record(target: string, claimant: string): number {
	const read = run_hold.read_hold(target)

	if (read.kind === 'free') return remove_record(target, false)

	if (read.kind === 'unreadable') return report_unreadable_record()

	if (!run_hold.is_own_hold(read.hold, claimant)) return report_held(read.hold)

	return remove_record(target, true)
}

// **A numbered run's own release takes its `in-progress` marker back off**,
// whether or not a record was still there — the stop that releases is the run ending its hold on the
// issue. A refused release (another run's record, an unreadable one) touches no label, and an
// unnumbered run names no issue to touch.
async function release(target: string, claimant: string): Promise<number> {
	const code = release_record(target, claimant)
	const is_own_end = code === SUCCESS_EXIT_CODE && claimant !== run_hold.UNNUMBERED_ISSUE

	if (is_own_end) await run_label.unmark(claimant)

	return code
}

// The one path that removes a record without matching it, which is why it says what it removed: a
// record genuinely abandoned by a crashed session has no run left to release it, and the eight-hour
// expiry alone leaves a dirty tree held until a person acts.
function force_release(target: string): number {
	const read = run_hold.read_hold(target)

	if (read.kind === 'held' || read.kind === 'stale') {
		console.error(run_hold.forced_release_message(read.hold))
	}

	return remove_record(target, read.kind !== 'free')
}

// A tree whose git directory cannot be read is `unknown` and exits non-zero, never `hold`: the guard
// has established nothing there, and a run that proceeds on it is the run this command exists to stop.
function report_unknown(): number {
	return report(run_hold.unknown_message(), UNKNOWN_VERDICT, FAILURE_EXIT_CODE)
}

function report_usage(): number {
	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

const SEND_BY_KIND: Readonly<Record<StopKind, (target: string, issue: string) => Promise<void>>> = {
	[HALFRUN_STOP_KIND]: run_stop_notify.send_halfrun,
	[HUMAN_REVIEW_STOP_KIND]: run_stop_notify.send_human_review,
	[PRRUN_STOP_KIND]: run_stop_notify.send_prrun,
}

// **A `halfrun` stop marks its own record** — the positive "this run has ended over its verified diff"
// that `run:entry` adopts on `fullrun #N`. Another run's record is left alone. A `needs-human-review`
// stop is the same mark, since its resume is `halfrun`'s. A `prrun` stop marks its record the same
// way, with the commit it stopped on. **A marked stop then sends its own `confirmation`**
// (`run-stop-notify.ts`), after the mark, since the mark rewrites the record its send is stamped on.
async function marked_stop(target: string, request: StopRequest): Promise<number> {
	if (request.kind === HUMAN_REVIEW_STOP_KIND) {
		await lane_state.record_change({
			issue: request.issue,
			state: 'human-review',
			command: 'run:hold --human-review-stop',
		})
	}

	await SEND_BY_KIND[request.kind](target, request.issue)

	return report_hold()
}

// **A stop before commit has no CI E2E job behind it**, so it is refused until `josh test:e2e` has
// answered green on this exact tree (`test-e2e-stamp.ts`). A `prrun` stop has a pull request, and CI's.
async function e2e_refusal(request: StopRequest): Promise<number | undefined> {
	if (request.kind === PRRUN_STOP_KIND || (await test_e2e_stamp.is_current_tree())) return undefined

	return report(
		'run:hold: `pnpm josh test:e2e` has not answered green on this tree — run it, then mark the stop again.',
		E2E_OWED_VERDICT,
		FAILURE_EXIT_CODE,
	)
}

async function mark_stop(target: string, request: StopRequest): Promise<number> {
	const refusal = await e2e_refusal(request)

	if (refusal !== undefined) return refusal

	const mark =
		request.kind === PRRUN_STOP_KIND
			? await run_prrun_resume.mark_stop_at(target, request.issue)
			: run_halfrun_resume.mark_stop_at(target, request.issue)

	if (mark === run_halfrun_resume.MARKED) return await marked_stop(target, request)

	if (mark === run_halfrun_resume.UNREADABLE) return report_unreadable_record()

	return report_busy(run_hold.race_message(run_hold.read_hold(target), target))
}

// The re-keyed record answers `hold`; no record answers `none` and another issue's `busy`, each a
// failure, since the run asking holds nothing it can stop on.
async function adopt(target: string, issue: string): Promise<number> {
	const result = await run_hold_adopt.adopt(target, issue)

	if (result === run_hold_adopt.ADOPTED) return report_hold()

	if (result === run_hold_adopt.UNREADABLE) return report_unreadable_record()

	if (result === run_hold_adopt.NO_RECORD) {
		return report(run_hold_adopt.no_record_message(issue), NONE_VERDICT, FAILURE_EXIT_CODE)
	}

	return report(run_hold_adopt.foreign_message(issue), BUSY_VERDICT, FAILURE_EXIT_CODE)
}

// The re-opened record answers `hold`; anything but #N's own stop answers `busy`, a failure, since
// the round has no stopped `halfrun` to pick up.
async function reopen_round(target: string, issue: string): Promise<number> {
	const result = await run_halfrun_resume.reopen(target, issue)

	if (result === run_halfrun_resume.MARKED) return report_hold()

	if (result === run_halfrun_resume.UNREADABLE) return report_unreadable_record()

	return report(run_halfrun_resume.no_stop_message(issue), BUSY_VERDICT, FAILURE_EXIT_CODE)
}

async function take_over(target: string, request: TakeOverRequest): Promise<number> {
	const { kind, issue } = request

	return kind === ADOPT_KIND ? await adopt(target, issue) : await reopen_round(target, issue)
}

async function dispatch(request: HoldRequest, target: string, is_linked: boolean): Promise<number> {
	if (request.kind === 'claim') return await claim(target, request, is_linked)

	if (is_take_over_request(request)) return await take_over(target, request)

	if (is_stop_request(request)) return await mark_stop(target, request)

	if (request.kind === FORCE_RELEASE_KIND) return force_release(target)

	return await release(target, request.claimant)
}

async function answer(request: HoldRequest): Promise<number> {
	const directory = await run_cli_fault.directory_of(COMMAND, run_hold.worktree_directory)

	if (directory === undefined) return report_unknown()

	const is_linked = await run_hold.is_linked_worktree()

	return await dispatch(request, run_hold.hold_path(directory), is_linked)
}

// **Every path out of here prints exactly one token**, including the ones nobody planned — a
// permission error on the record, or a git binary that is not there: an empty `$answer` matches none
// of the three tokens, which an entry point would read as "not busy" and walk straight past the guard.
// The token stays `unknown`, and the failure says what it was rather than borrowing the
// unreadable-git-directory message.
async function run(argv: ReadonlyArray<string>): Promise<number> {
	const request = parse_request(argv)

	if (request === undefined) return report_usage()

	try {
		return await answer(request)
	} catch (error) {
		return report(run_cli_fault.message(COMMAND, error), UNKNOWN_VERDICT, FAILURE_EXIT_CODE)
	}
}

const run_hold_cli = {
	BUSY_VERDICT,
	HELD_VERDICT,
	HOLD_VERDICT,
	NONE_VERDICT,
	RELEASED_VERDICT,
	UNKNOWN_VERDICT,
	USAGE,
	parse_request,
	run,
}

export { run_hold_cli }
