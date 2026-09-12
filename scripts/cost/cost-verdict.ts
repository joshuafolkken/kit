import { cost_curve } from './cost-curve'
import type { CostReport } from './cost-report'

// The hand-off flags of `josh cost`, kept apart from the CLI wiring because each turns a run into a
// one-line verdict rather than a table (joshuafolkken/kit#1838). `--over` answers what the next turn
// of a session will cost; `--cap` answers what share of a run's cost fell at or under a per-request
// context cap.

const FAILURE_EXIT_CODE = 1
const OVER_VERDICT = 'over'
const UNDER_VERDICT = 'under'

// What a turn costs is decided by the accumulated preamble, not by what the turn does, so the
// marginal cost of a session is its billed input divided by the requests that paid for it. Measured
// across one `epicrun` that ran six children in one context: 222k per request during the first
// child, 645k during the sixth — the same work at 2.9x the price (joshuafolkken/kit#968).
//
// Per request rather than in total, because the total only says the session was long. The ratio
// says what the *next* turn will cost, which is the thing a hand-off decision turns on.
function per_request_cost(report: CostReport): number {
	if (report.request_count === 0) return 0

	return Math.round(report.breakdown.billed_input_tokens / report.request_count)
}

// A verdict, not a table: the point of the flag is that the hand-off is decided by a number rather
// than by whether the run feels long, which is a judgement made under exactly the pressure that
// resolves it the wrong way.
function report_over(reports: ReadonlyArray<CostReport>, limit: number): number {
	const [report] = reports

	if (report === undefined) return FAILURE_EXIT_CODE

	if (report.request_count === 0) {
		console.error('No requests in this session; there is nothing to hand off.')

		return FAILURE_EXIT_CODE
	}

	const cost = per_request_cost(report)

	console.info(cost > limit ? OVER_VERDICT : UNDER_VERDICT)
	console.error(
		`${String(cost)} billed input tokens per request over ${String(report.request_count)} request(s); limit ${String(limit)}`,
	)

	return 0
}

// The cap counterfactual as a ratio rather than a table: what share of this run's priced cost was
// incurred by requests at or under the cap. `not measured` when nothing could be priced, never 0.
function report_cap(reports: ReadonlyArray<CostReport>, cap: number): number {
	const [report] = reports
	const simulation = report?.cap_simulation

	if (simulation === undefined) {
		console.error('No requests in this scope; there is nothing to cap.')

		return FAILURE_EXIT_CODE
	}

	console.info(cost_curve.ratio_text(simulation))
	console.error(
		`${String(simulation.within_cap_requests)} of ${String(simulation.total_requests)} request(s) at or under ${String(cap)} tokens/request`,
	)

	return 0
}

const cost_verdict = {
	OVER_VERDICT,
	UNDER_VERDICT,
	per_request_cost,
	report_over,
	report_cap,
}

export { cost_verdict }
