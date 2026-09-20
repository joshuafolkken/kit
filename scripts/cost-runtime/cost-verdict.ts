// The `--over` hand-off flag of `josh cost`, kept apart from the CLI wiring because it turns a run
// into a one-line verdict rather than a table (joshuafolkken/kit#1838). It answers what the next turn
// of a session will cost, and takes only the figures its verdict needs — an over measurement — never
// a whole report. The `--cap` counterfactual it once sat beside was retired in #2016 as readerless.

const FAILURE_EXIT_CODE = 1
const OVER_VERDICT = 'over'
const UNDER_VERDICT = 'under'

// What `--over` reads of a session: how many requests paid, and the billed input they paid for.
interface OverMeasurement {
	request_count: number
	billed_input_tokens: number
}

// What a turn costs is decided by the accumulated preamble, not by what the turn does, so the
// marginal cost of a session is its billed input divided by the requests that paid for it. Measured
// across one `epicrun` that ran six children in one context: 222k per request during the first
// child, 645k during the sixth — the same work at 2.9x the price (joshuafolkken/kit#968).
//
// Per request rather than in total, because the total only says the session was long. The ratio
// says what the *next* turn will cost, which is the thing a hand-off decision turns on.
function per_request_cost(measurement: OverMeasurement): number {
	if (measurement.request_count === 0) return 0

	return Math.round(measurement.billed_input_tokens / measurement.request_count)
}

// The bare over/under decision, without a report: `run:status` reads this same verdict read-only
// (joshuafolkken/kit#2165), so the comparison lives here once rather than being copied there. A
// threshold of exactly `cost` is under, matching the `>` the printed report used.
function classify(
	measurement: OverMeasurement,
	limit: number,
): typeof OVER_VERDICT | typeof UNDER_VERDICT {
	return per_request_cost(measurement) > limit ? OVER_VERDICT : UNDER_VERDICT
}

// A verdict, not a table: the point of the flag is that the hand-off is decided by a number rather
// than by whether the run feels long, which is a judgement made under exactly the pressure that
// resolves it the wrong way.
function report_over(measurement: OverMeasurement | undefined, limit: number): number {
	if (measurement === undefined || measurement.request_count === 0) {
		console.error('No requests in this session; there is nothing to hand off.')

		return FAILURE_EXIT_CODE
	}

	console.info(classify(measurement, limit))
	console.error(
		`${String(per_request_cost(measurement))} billed input tokens per request over ${String(measurement.request_count)} request(s); limit ${String(limit)}`,
	)

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
