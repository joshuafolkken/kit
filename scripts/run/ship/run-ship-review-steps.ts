import type { JoshResult } from '#scripts/josh/josh-run'
import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { lane_round_one_stats } from '#scripts/lane/lane-round-one-stats'
import { review_attest, type ReviewSlot } from '#scripts/review/review-attest'
import { review_interaction } from '#scripts/review/review-interaction'
import { review_reviewed_tree } from '#scripts/review/review-reviewed-tree'
import { review_round_reuse } from '#scripts/review/review-round-reuse'
import { review_round2 } from '#scripts/review/review-round2'
import { run_review } from '#scripts/run/review/run-review'
import { run_ship_review, type RoundOutcome, type ScoredVerdict } from './run-ship-review'
import { run_ship_reviewer, type Round } from './run-ship-reviewer'
import { run_ship_scoped } from './run-ship-scoped'
import { run_ship_stop_cause } from './run-ship-stop-cause'
import type { StepResult } from './run-ship-sync'

// The side effects of `josh ship --review`: the round-1 review — open, launch, join, attest and
// record — run by the supervisor beside the gate rather than across agent turns. Each step is the
// existing command or mechanism, composed rather than cloned:
//
// 1. `run:review` starts the gate detached and mints the brief — the nonce `review:attest` checks.
// 2. the reviewer is launched the way `run:wake` launches a session — `agent_argv` under the reviewer
//    profile, `detached_launch.launch_attached` to wait for its exit — handed the brief by path
//    (`run-ship-reviewer.ts`).
// 3. `run:review --join` blocks a verdict over a red gate; `review:attest --check` refuses a review
//    that read another checkout; `review:record` writes the round the merge gate reads.
//
// **Round 1's local fixes and round 2 stay inside the supervisor**. A round-1
// reviewer that fixed its local Mediums in place changed the tree the background gate read, so that
// join drains the gate rather than judging it — the ship's gate stage re-runs on the fixed tree. After
// the commit, `round_two_stage` asks `review:round2 --round-1-closed` whether the fix delta owes a
// second round, and on `required` runs it through the same commands the chain does: the scoped pair
// `review:brief` requires, `review:brief --round 2`, a fresh reviewer session, attest and record.
//
// **A precondition the supervisor can meet itself is met, not stopped on**.
// The scoped pair `run:review` and the local gate refuse without is run in place when this tree has no
// green record, and a round-1 fix is counted only once that pair is green on the fixed tree.
//
// **Every failure returns control to the agent**: a non-zero step, a reviewer that did not finish, an
// unreadable findings file, a High or an unfixed Medium in round 1, and anything but a clean round 2 —
// recorded first, because the round was attested, then routed back.

const RUN_REVIEW = 'run:review'
const ROUND_TWO_DECISION = ['review:round2', '--round-1-closed', '--json']
const REVIEW_BRIEF = 'review:brief'
const ROUND_TWO_BRIEF = [REVIEW_BRIEF, '--round', '2']
const INTERACTION_FLAG = '--interaction'
const INTERACTION_BRIEF = [REVIEW_BRIEF, INTERACTION_FLAG]
const UNREADABLE_DECISION_NOTE = 'review:round2 printed no decision josh ship can read:'
const COMMENT_FLAG = '--comment'

const FIXED_JOIN_NOTE =
	'the round-1 gate read the tree before the review fixes — drained, not judged; the gate re-runs once the tree is fixed.'
const ROUND_TWO_SKIPPED_NOTE = 'round 2 not due — nothing left to verify; shipping on.'
const ROUND_ONE_RECORDED_NOTE =
	'round 1 already recorded — reused, not reviewed again; round 2 decides on the fix delta after the commit.'

// The scoped pair's precondition, met by the supervisor itself rather than stopped on,
// single-sourced with the preflight and gate stages.
const { run_phases, scoped_pair } = run_ship_scoped
const { CAUSE } = run_ship_stop_cause
const { CODE, INTERACTION } = review_attest.REVIEW_SLOT
// `run:review` opens code's brief alone here: the interaction slot's is the ship's own open beside it.
const ROUND_ONE_OPENS: Readonly<Record<ReviewSlot, ReadonlyArray<string>>> = {
	code: [RUN_REVIEW, run_review.CODE_ONLY_FLAG],
	interaction: INTERACTION_BRIEF,
}
const SLOT_RECORD_FLAGS: Readonly<Record<ReviewSlot, ReadonlyArray<string>>> = {
	code: [],
	interaction: [INTERACTION_FLAG],
}
const {
	attest_phase,
	current_verdict,
	failure,
	josh,
	note,
	paths,
	reviewed,
	reviewed_together,
	ROUND_ONE,
	ROUND_TWO,
	SUCCESS_EXIT_CODE,
	tagged,
	tagged_phase,
} = run_ship_reviewer

// A red join blocks unless the reviewer fixed findings in place: the background gate then read the
// tree before the fixes, so its verdict describes a tree that no longer exists. The join still ran to
// its end, so the gate stage that follows never races it. Any fix drains it, not only a round whose
// every finding was fixed — a partial fix moved the tree just the same, and the round then stops on its
// unfixed finding at the record rather than on a `Gate RED` the gate never earned.
// Either slot's reviewer fixing in place moved the tree.
function has_fixes(slots: ReadonlyArray<ReviewSlot>): boolean {
	return slots.some((slot) =>
		run_ship_review.has_fixes(stamp_file.read_stamp_text(paths(slot).findings)),
	)
}

// **The tree is asked first, the findings file second** (joshuafolkken/kit#4774): a gate that passed on
// a tree that has since moved exits the join with its own code, which drains it whatever the reviewer
// wrote, or failed to write, at its findings path. An unpinned change is never drained
// (joshuafolkken/kit#4770): a reviewer's fix moved the tree, not the probe's answer.
function is_drained(code: number, slots: ReadonlyArray<ReviewSlot>): boolean {
	if (code === run_review.UNPINNED_EXIT_CODE) return false

	return code === run_review.MOVED_EXIT_CODE || has_fixes(slots)
}

async function join_gate(slots: ReadonlyArray<ReviewSlot>): Promise<JoshResult> {
	const joined = await josh([RUN_REVIEW, '--join'])

	if (joined.code === SUCCESS_EXIT_CODE || !is_drained(joined.code, slots)) return joined

	note(FIXED_JOIN_NOTE)

	return { code: SUCCESS_EXIT_CODE, out: joined.out }
}

// **A passing round 2 is recorded on the issue, not in the tree**: it ran after the commit and reads
// only, so no commit of the run's follows it, and a line appended now would be pushed onto the open
// pull request by `pnpm josh followup` — restarting the CI the round ran beside. A blocking round 2
// keeps the tree: the fix it stops for is pushed anyway, and carries the lines.
function record_flags(round: Round, outcome: RoundOutcome): ReadonlyArray<string> {
	return round === ROUND_TWO && outcome.is_passing ? [COMMENT_FLAG] : []
}

// The interaction slot records with `--interaction`, its `- ri:` line.
async function record_and_route(
	issue: string,
	round: Round,
	outcome_of: (verdict: ScoredVerdict) => RoundOutcome,
	slot: ReviewSlot = CODE,
): Promise<StepResult> {
	const verdict = current_verdict(slot)

	if (verdict.kind === run_ship_review.VERDICT.INVALID) return failure(verdict.note, CAUSE.INFRA)

	const outcome = outcome_of(verdict)
	const flags = [...SLOT_RECORD_FLAGS[slot], ...record_flags(round, outcome)]
	const recorded = await josh(['review:record', '--issue', issue, ...flags, ...verdict.specs])

	if (recorded.code !== SUCCESS_EXIT_CODE) return tagged(CAUSE.CHECK, recorded)

	const out = [...verdict.report, outcome.note].join('\n')

	return outcome.is_passing ? { code: SUCCESS_EXIT_CODE, out } : failure(out, CAUSE.FINDING)
}

// Fixes made in place are counted only once the scoped pair is green on the fixed tree. The reviewer is
// asked to leave it green; this is the check that it did, and a fix it could not get green is routed as
// the finding it still is — recorded, then stopped before the gate and the commit take it in. One
// scoped pair answers for every slot's fixes: they share the tree.
async function is_fix_verified(slots: ReadonlyArray<ReviewSlot>): Promise<boolean> {
	const is_fixed = slots.some(
		(slot) => current_verdict(slot).kind === run_ship_review.VERDICT.FIXED,
	)

	if (!is_fixed) return true

	const checked = await scoped_pair()

	return checked.code === SUCCESS_EXIT_CODE
}

async function round_one_record(
	issue: string,
	slot: ReviewSlot,
	is_verified: boolean,
): Promise<StepResult> {
	return await record_and_route(
		issue,
		ROUND_ONE,
		(verdict) =>
			is_verified ? run_ship_review.round_one_outcome(verdict) : run_ship_review.UNVERIFIED_OUTCOME,
		slot,
	)
}

// Both reviews' reports in one result, stopped on the first slot that stopped — so a fix answers
// every finding at once (joshuafolkken/kit#4672).
function merged(results: ReadonlyArray<StepResult>): StepResult {
	const out = results.map((result) => result.out).join('\n')
	const stopped = results.find((result) => result.code !== SUCCESS_EXIT_CODE)

	return stopped === undefined ? { code: SUCCESS_EXIT_CODE, out } : { ...stopped, out }
}

async function record_slots(issue: string, slots: ReadonlyArray<ReviewSlot>): Promise<StepResult> {
	const is_verified = await is_fix_verified(slots)
	const results: Array<StepResult> = []

	for (const slot of slots) {
		// eslint-disable-next-line no-await-in-loop -- one `review:record` at a time: each appends to the issue's ledger
		const result = await round_one_record(issue, slot, is_verified)

		results.push(result)
	}

	return merged(results)
}

// A round that had nothing to review: it passes, and the ship does not time it as a review that ran.
function skipped(out: string): StepResult {
	return { code: SUCCESS_EXIT_CODE, out, is_skipped: true }
}

// How the ship's round 1 ended, for `josh lane:stats` to count the rounds that passed with no fix
// (joshuafolkken/kit#4620). An unreadable verdict is no outcome; the round stops on it as infra. A
// round whose `review:record` failed is not counted either: the relaunch re-runs it, and that run is
// the one that ended.
async function record_outcome(issue: string, verdict: string, cause?: string): Promise<void> {
	if (verdict === run_ship_review.VERDICT.INVALID || cause === CAUSE.CHECK) return

	await lane_ledger.record_round_one({ issue: Number(issue), verdict })
}

// Over every slot: either slot's fix moved the tree round 1 is gated on, so the round is `fixed`, and
// an unreadable slot leaves it uncounted.
function round_one_kind(slots: ReadonlyArray<ReviewSlot>): string {
	const kinds = new Set(slots.map((slot) => current_verdict(slot).kind))
	const { FIXED, INVALID } = run_ship_review.VERDICT

	if (kinds.has(INVALID)) return INVALID

	return kinds.has(FIXED) ? FIXED : current_verdict().kind
}

// A round that stops on a finding — a fix the scoped pair did not get green included — is counted as
// `blocking`, and marks its round reusable however the fix then moves the tree. Written once, over
// every slot's result.
async function code_round_one_record(
	issue: string,
	slots: ReadonlyArray<ReviewSlot>,
): Promise<StepResult> {
	const kind = round_one_kind(slots)
	const recorded = await record_slots(issue, slots)
	const is_stopped = recorded.cause === CAUSE.FINDING

	review_reviewed_tree.mark_stopped(Number(issue), is_stopped)
	await record_outcome(issue, is_stopped ? run_ship_review.VERDICT.BLOCKING : kind, recorded.cause)

	return recorded
}

// `run:review` alone takes the implementer's `--unpinned-ok "<reason>"`; the interaction brief runs no
// `test:pinned` check for it to carry past.
function round_one_opens(
	slots: ReadonlyArray<ReviewSlot>,
	unpinned_ok: ReadonlyArray<string>,
): Array<{ open: ReadonlyArray<string>; slot: ReviewSlot }> {
	return slots.map((slot) => ({
		open: slot === CODE ? [...ROUND_ONE_OPENS[slot], ...unpinned_ok] : ROUND_ONE_OPENS[slot],
		slot,
	}))
}

// The round-1 review, beside the gate: scoped pair → open each slot's brief → their reviewers side by
// side → join → attest → record, stopping at the first that did not pass.
async function round_one_stage(
	issue: string,
	is_stale: boolean,
	slots: ReadonlyArray<ReviewSlot>,
	unpinned_ok: ReadonlyArray<string>,
): Promise<StepResult> {
	// The reuse question `review:record --check` answers too (`review-round-reuse.ts`).
	if (await review_round_reuse.is_reusable(Number(issue), is_stale)) {
		await record_outcome(issue, lane_round_one_stats.REUSED)

		return skipped(ROUND_ONE_RECORDED_NOTE)
	}

	// A stale record narrows nothing: the next round reads the whole change under the new specification.
	if (is_stale) review_reviewed_tree.discard()
	const opens = round_one_opens(slots, unpinned_ok)

	return await run_phases([
		tagged_phase(CAUSE.CHECK, scoped_pair),
		...reviewed_together(opens, run_ship_review.reviewer_prompt, issue, ROUND_ONE),
		tagged_phase(CAUSE.CHECK, async () => await join_gate(slots)),
		attest_phase,
		async () => await code_round_one_record(issue, slots),
	])
}

// The interaction review alone (joshuafolkken/kit#4276), after a reused round 1: scoped pair →
// `review:brief --interaction` → reviewer → attest → `review:record --interaction`. Its fixes are
// verified as round 1's are; no join, since round 1 already drained the gate.
async function interaction_stage(issue: string): Promise<StepResult> {
	const opens = [{ open: INTERACTION_BRIEF, slot: INTERACTION }]

	return await run_phases([
		tagged_phase(CAUSE.CHECK, scoped_pair),
		...reviewed_together(opens, run_ship_review.reviewer_prompt, issue, ROUND_ONE),
		attest_phase,
		async () => await record_slots(issue, [INTERACTION]),
	])
}

async function due_slots(issue: string): Promise<ReadonlyArray<ReviewSlot>> {
	return review_interaction.round_one_slots(await review_interaction.status(Number(issue)))
}

async function is_interaction_due(issue: string): Promise<boolean> {
	const slots = await due_slots(issue)

	return slots.includes(INTERACTION)
}

// Owed after a round 1 that passed and is still not recorded — so a relaunched ship whose round 1 is
// recorded still owes it.
async function is_interaction_owed(issue: string, first: StepResult): Promise<boolean> {
	if (first.code !== SUCCESS_EXIT_CODE) return false

	return await is_interaction_due(issue)
}

// **The interaction review runs beside round 1 where it is due and not yet recorded**
// (joshuafolkken/kit#4672), so the two take one wait and one stop. **It is asked again after a round 1
// that passed**: a reused round 1 still owes it, and a round-1 fix may be the first to touch the run
// tooling — either way it then runs alone. The first stop is returned as it is.
async function review_stage(
	issue: string,
	is_stale = false,
	unpinned_ok: ReadonlyArray<string> = [],
): Promise<StepResult> {
	const slots = await due_slots(issue)
	const first = await round_one_stage(issue, is_stale, slots, unpinned_ok)

	if (!(await is_interaction_owed(issue, first))) return first

	const second = await interaction_stage(issue)

	if (second.code !== SUCCESS_EXIT_CODE) return second

	return { code: SUCCESS_EXIT_CODE, out: [first.out, second.out].join('\n') }
}

// The round-2 verification pass, after the commit so it runs beside CI: due only when the round-1 fix
// delta says so, then scoped pair → brief → fresh reviewer → attest → record.
//
// **The decision is read as JSON and recorded in the lane ledger before it is acted on**, so
// `josh lane:stats` can count the period's round-2 runs and skips by their reason code
// (joshuafolkken/kit#4064). Output it cannot parse stops the ship rather than guessing a verdict.
async function round_two_stage(issue: string): Promise<StepResult> {
	const decision = await josh(ROUND_TWO_DECISION)

	if (decision.code !== SUCCESS_EXIT_CODE) return tagged(CAUSE.CHECK, decision)

	const answer = review_round2.parse_json(decision.out)

	if (answer === undefined) {
		return failure(`${UNREADABLE_DECISION_NOTE}\n${decision.out}`, CAUSE.CHECK)
	}

	note(answer.reason)
	await lane_ledger.record_round_two({
		issue: Number(issue),
		verdict: answer.verdict,
		code: answer.code,
	})

	if (answer.verdict !== review_round2.REQUIRED_VERDICT) {
		return skipped(`${answer.verdict}\n${ROUND_TWO_SKIPPED_NOTE}`)
	}

	return await run_phases([
		tagged_phase(CAUSE.CHECK, scoped_pair),
		...reviewed(ROUND_TWO_BRIEF, run_ship_review.verification_prompt, issue, ROUND_TWO),
		attest_phase,
		async () => await record_and_route(issue, ROUND_TWO, run_ship_review.round_two_outcome),
	])
}

const run_ship_review_steps = { review_stage, round_two_stage }

export { run_ship_review_steps }
