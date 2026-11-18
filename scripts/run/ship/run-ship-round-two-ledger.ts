import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import type { RoundTwoAnswer } from '#scripts/review/review-round2'
import { run_ship_review } from './run-ship-review'
import { run_ship_reviewer } from './run-ship-reviewer'
import { run_ship_stop_cause } from './run-ship-stop-cause'
import type { StepResult } from './run-ship-sync'

// The lane ledger's record of one round-2 decision a `josh ship` acted on, with the run's outcome when
// it ran, so `josh lane:stats` can count runs and the runs that found something by reason code
// (joshuafolkken/kit#7873). A skip is recorded without a run; a run is recorded after it, with
// `findings` only when it reached a verdict — passing, or stopped on a finding. Any other stop leaves
// the field out, unknown rather than guessed empty.

const { CAUSE } = run_ship_stop_cause

function is_verdict_reached(result: StepResult): boolean {
	return result.code === run_ship_reviewer.SUCCESS_EXIT_CODE || result.cause === CAUSE.FINDING
}

function outcome_findings(result: StepResult): ReadonlyArray<string> | undefined {
	if (!is_verdict_reached(result)) return undefined

	const verdict = run_ship_reviewer.current_verdict()

	if (verdict.kind === run_ship_review.VERDICT.INVALID) return undefined

	return run_ship_review.finding_kinds(verdict)
}

async function record(issue: string, answer: RoundTwoAnswer, result?: StepResult): Promise<void> {
	const findings = result === undefined ? undefined : outcome_findings(result)
	const outcome = findings === undefined ? {} : { findings: [...findings] }

	await lane_ledger_write.record_round_two({
		issue: Number(issue),
		verdict: answer.verdict,
		code: answer.code,
		...outcome,
	})
}

const run_ship_round_two_ledger = { record }

export { run_ship_round_two_ledger }
