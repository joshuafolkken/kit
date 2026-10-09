// The `--over` hand-off flag of `josh cost`, kept apart from the CLI wiring because it turns a run
// into a one-line verdict rather than a table. It answers what the next turn
// of a session will cost, and takes only the figures its verdict needs — an over measurement — never
// a whole report. The `--cap` counterfactual it once sat beside was retired in #2016 as readerless.

const FAILURE_EXIT_CODE = 1
const OVER_VERDICT = 'over'
const UNDER_VERDICT = 'under'

// What `--over` reads of a session: the billed input each request paid, oldest first. The sequence
// is carried rather than a single sum because the hand-off prices the newest request alone
// — a sum could not answer what the session's current context costs.
interface OverMeasurement {
	billed_input_per_request: ReadonlyArray<number>
}

// What a turn costs is decided by the accumulated preamble, not by what the turn does, so the
// marginal cost of a session is the billed input its newest request paid. Measured across one
// `epicrun` that ran six children in one context: 222k per request during the first child, 645k
// during the sixth — the same work at 2.9x the price.
//
// **The newest request, not an average.** A whole-session average lags a long parent by dozens of
// requests, and even the average of the last ten lags. A session's billed input only grows between compactions (a unit writes its own transcript),
// so an average smooths no outlier — it only trails the context it averages. On 2026-10-05 wake
// session 03367124 crossed the threshold at request 65 and its ten-request average at request 70.
// The threshold is a break-even on the *current* context
// (`context-cut-payback.ts`), so the current context is what it is compared against.
function per_request_cost(measurement: OverMeasurement): number {
	return measurement.billed_input_per_request.at(-1) ?? 0
}

// The bare over/under decision, without a report: `run:status` reads this same verdict read-only,
// so the comparison lives here once rather than being copied there. A
// threshold of exactly `cost` is under, matching the `>` the printed report used.
function classify(
	measurement: OverMeasurement,
	limit: number,
): typeof OVER_VERDICT | typeof UNDER_VERDICT {
	return per_request_cost(measurement) > limit ? OVER_VERDICT : UNDER_VERDICT
}

// The stderr line names which request was priced, so the reader can tell the newest request's cost
// from an average over the session.
function over_summary(measurement: OverMeasurement, limit: number): string {
	const total = measurement.billed_input_per_request.length

	return `${String(per_request_cost(measurement))} billed input tokens per request, on the newest of ${String(total)} request(s); limit ${String(limit)}`
}

// A verdict, not a table: the point of the flag is that the hand-off is decided by a number rather
// than by whether the run feels long, which is a judgement made under exactly the pressure that
// resolves it the wrong way.
function report_over(measurement: OverMeasurement | undefined, limit: number): number {
	if (measurement === undefined || measurement.billed_input_per_request.length === 0) {
		console.error('No requests in this session; there is nothing to hand off.')

		return FAILURE_EXIT_CODE
	}

	console.info(classify(measurement, limit))
	console.error(over_summary(measurement, limit))

	return 0
}

const cost_verdict = {
	OVER_VERDICT,
	UNDER_VERDICT,
	classify,
	per_request_cost,
	report_over,
}

export type { OverMeasurement }
export { cost_verdict }
