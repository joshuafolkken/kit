import { review_attest, type ReviewSlot } from '#scripts/review/review-attest'
import { review_stop_log } from '#scripts/review/review-stop-log'
import { run_ship_review, type RoundOutcome, type ScoredVerdict } from './run-ship-review'
import { run_ship_reviewer, type Round } from './run-ship-reviewer'
import { run_ship_scoped } from './run-ship-scoped'
import { run_ship_stage } from './run-ship-stage'
import { run_ship_stop_cause } from './run-ship-stop-cause'
import type { StepResult } from './run-ship-sync'

// The record half of `josh ship --review` (`run-ship-review-steps.ts`): a round's verdict is routed
// through `review:record` — the round the merge gate reads — and back to the agent when it stops.

const INTERACTION_FLAG = '--interaction'
const COMMENT_FLAG = '--comment'

const { scoped_pair } = run_ship_scoped
const { CAUSE } = run_ship_stop_cause
const { CODE } = review_attest.REVIEW_SLOT
const SLOT_RECORD_FLAGS: Readonly<Record<ReviewSlot, ReadonlyArray<string>>> = {
	code: [],
	interaction: [INTERACTION_FLAG],
}
const { current_verdict, failure, josh, ROUND_TWO, SUCCESS_EXIT_CODE, tagged } = run_ship_reviewer

// A passing round 2 records on the issue so it cannot move the tree the parallel gate reads.
// Blocking findings stop both stages before the commit (`review-record-comment.ts`).
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
	const specs = run_ship_review.recorded_specs(verdict, outcome)
	const recorded = await josh(['review:record', '--issue', issue, ...flags, ...specs])

	if (recorded.code !== SUCCESS_EXIT_CODE) return tagged(CAUSE.CHECK, recorded)

	review_stop_log.record({
		issue: Number(issue),
		stage: run_ship_stage.STAGE.REVIEW,
		findings: run_ship_review.passing_fixes(verdict, outcome),
		is_fixed: true,
	})

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

function outcome_for_round(round: Round, verdict: ScoredVerdict): RoundOutcome {
	return round === ROUND_TWO
		? run_ship_review.round_two_outcome(verdict)
		: run_ship_review.round_one_outcome(verdict)
}

const run_ship_review_record = {
	INTERACTION_FLAG,
	is_fix_verified,
	outcome_for_round,
	record_and_route,
	record_flags,
}

export { run_ship_review_record }
