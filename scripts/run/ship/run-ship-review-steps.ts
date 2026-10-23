import type { JoshResult } from '#scripts/josh/josh-run'
import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { lane_round_one_stats } from '#scripts/lane/lane-round-one-stats'
import { review_interaction } from '#scripts/review/review-interaction'
import { review_record } from '#scripts/review/review-record'
import { review_reviewed_tree } from '#scripts/review/review-reviewed-tree'
import { review_round2 } from '#scripts/review/review-round2'
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
const {
	attest_phase,
	current_verdict,
	failure,
	josh,
	note,
	paths,
	reviewed,
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
async function join_gate(): Promise<JoshResult> {
	const joined = await josh([RUN_REVIEW, '--join'])

	if (
		joined.code === SUCCESS_EXIT_CODE ||
		!run_ship_review.has_fixes(stamp_file.read_stamp_text(paths().findings))
	) {
		return joined
	}

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

// `kind` is the record's own flags — `--interaction` for the interaction review's `- ri:` line.
async function record_and_route(
	issue: string,
	round: Round,
	outcome_of: (verdict: ScoredVerdict) => RoundOutcome,
	kind: ReadonlyArray<string> = [],
): Promise<StepResult> {
	const verdict = current_verdict()

	if (verdict.kind === run_ship_review.VERDICT.INVALID) return failure(verdict.note, CAUSE.INFRA)

	const outcome = outcome_of(verdict)
	const flags = [...kind, ...record_flags(round, outcome)]
	const recorded = await josh(['review:record', '--issue', issue, ...flags, ...verdict.specs])

	if (recorded.code !== SUCCESS_EXIT_CODE) return tagged(CAUSE.CHECK, recorded)

	const out = [...verdict.report, outcome.note].join('\n')

	return outcome.is_passing ? { code: SUCCESS_EXIT_CODE, out } : failure(out, CAUSE.FINDING)
}

// Fixes made in place are counted only once the scoped pair is green on the fixed tree. The reviewer is
// asked to leave it green; this is the check that it did, and a fix it could not get green is routed as
// the finding it still is — recorded, then stopped before the gate and the commit take it in.
async function round_one_record(issue: string, kind?: ReadonlyArray<string>): Promise<StepResult> {
	const is_fixed = current_verdict().kind === run_ship_review.VERDICT.FIXED
	const checked = is_fixed ? await scoped_pair() : undefined
	const is_verified = checked === undefined || checked.code === SUCCESS_EXIT_CODE

	return await record_and_route(
		issue,
		ROUND_ONE,
		(verdict) =>
			is_verified ? run_ship_review.round_one_outcome(verdict) : run_ship_review.UNVERIFIED_OUTCOME,
		kind,
	)
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

// A round that stops on a finding — a fix the scoped pair did not get green included — is counted as
// `blocking`, and marks its round reusable however the fix then moves the tree.
async function code_round_one_record(issue: string): Promise<StepResult> {
	const { kind } = current_verdict()
	const recorded = await round_one_record(issue)
	const is_stopped = recorded.cause === CAUSE.FINDING

	review_reviewed_tree.mark_stopped(Number(issue), is_stopped)
	await record_outcome(issue, is_stopped ? run_ship_review.VERDICT.BLOCKING : kind, recorded.cause)

	return recorded
}

// **A recorded round 1 is reused while the tree it was recorded on holds still** — a lane's review
// before the ship (joshuafolkken/kit#4620) — **or after the ship's own round 1 stopped on a finding**,
// however the lane's fix moved the tree: that fix delta is round 2's after the commit. Any other tree
// that moved since is reviewed again, from that record (`review-reviewed-tree.ts`), so the round reads
// the delta alone. An issue that changed after that round's brief is never reused: the recorded
// round never read it, and `josh followup` refuses the merge on it (joshuafolkken/kit#4221).
async function is_reusable(issue: string, is_stale: boolean): Promise<boolean> {
	if (is_stale) return false

	const recorded = await review_record.check(Number(issue))

	if (recorded.status !== 'ok') return false

	return (
		review_reviewed_tree.is_stopped_on(Number(issue)) ||
		(await review_reviewed_tree.is_unmoved_here())
	)
}

// The round-1 review, beside the gate: scoped pair → open → review → join → attest → record, stopping
// at the first that did not pass.
async function round_one_stage(issue: string, is_stale: boolean): Promise<StepResult> {
	if (await is_reusable(issue, is_stale)) {
		await record_outcome(issue, lane_round_one_stats.REUSED)

		return skipped(ROUND_ONE_RECORDED_NOTE)
	}

	// A stale record narrows nothing: the next round reads the whole change under the new specification.
	if (is_stale) review_reviewed_tree.discard()

	return await run_phases([
		tagged_phase(CAUSE.CHECK, scoped_pair),
		...reviewed([RUN_REVIEW], run_ship_review.reviewer_prompt, issue, ROUND_ONE),
		tagged_phase(CAUSE.CHECK, join_gate),
		attest_phase,
		async () => await code_round_one_record(issue),
	])
}

// The interaction review (joshuafolkken/kit#4276): after round 1, over a change to the run tooling,
// scoped pair → `review:brief --interaction` → reviewer → attest → `review:record --interaction`. Its
// fixes are verified as round 1's are; no join, since round 1 already drained the gate.
async function interaction_stage(issue: string): Promise<StepResult> {
	return await run_phases([
		tagged_phase(CAUSE.CHECK, scoped_pair),
		...reviewed(INTERACTION_BRIEF, run_ship_review.reviewer_prompt, issue, ROUND_ONE),
		attest_phase,
		async () => await round_one_record(issue, [INTERACTION_FLAG]),
	])
}

// Round 1, then the interaction review where it is due and not yet recorded — so a relaunched ship
// whose round 1 is recorded still owes it. The first stop is returned as it is.
async function review_stage(issue: string, is_stale = false): Promise<StepResult> {
	const first = await round_one_stage(issue, is_stale)

	if (
		first.code !== SUCCESS_EXIT_CODE ||
		(await review_interaction.status(Number(issue))) !== 'missing'
	) {
		return first
	}

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
