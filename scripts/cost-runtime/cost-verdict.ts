// The `--over` hand-off flag of `josh cost`, kept apart from the CLI wiring because it turns a run
// into a one-line verdict rather than a table (joshuafolkken/kit#1838). It answers what the next turn
// of a session will cost, and takes only the figures its verdict needs — an over measurement — never
// a whole report. The `--cap` counterfactual it once sat beside was retired in #2016 as readerless.

import { RECENT_REQUEST_WINDOW } from './context-cut-threshold'

const FAILURE_EXIT_CODE = 1
const OVER_VERDICT = 'over'
const UNDER_VERDICT = 'under'

// What `--over` reads of a session: the billed input each request paid, oldest first. The whole
// per-request sequence is carried rather than a single sum because the hand-off prices the recent
// tail alone (joshuafolkken/kit#2295) — a long session's whole-session average lags its current
// context by dozens of requests, so a sum could not answer what the recent window actually cost.
interface OverMeasurement {
	billed_input_per_request: ReadonlyArray<number>
}

// The most recent requests the hand-off prices, oldest first — the whole sequence when it is shorter
// than the window, so a session with fewer than `RECENT_REQUEST_WINDOW` requests is priced on what it
// has rather than padded.
function recent_requests(measurement: OverMeasurement): ReadonlyArray<number> {
	return measurement.billed_input_per_request.slice(-RECENT_REQUEST_WINDOW)
}

// What a turn costs is decided by the accumulated preamble, not by what the turn does, so the
// marginal cost of a session is the billed input its recent requests paid. Measured across one
// `epicrun` that ran six children in one context: 222k per request during the first child, 645k
// during the sixth — the same work at 2.9x the price (joshuafolkken/kit#968).
//
// The recent window rather than the whole session, because a long parent's whole-session average
// lags its current context by dozens of requests (joshuafolkken/kit#2295); the recent average says
// what the *next* turn will cost, which is the thing a hand-off decision turns on.
function per_request_cost(measurement: OverMeasurement): number {
	const window = recent_requests(measurement)
	if (window.length === 0) return 0

	const total = window.reduce((sum, billed) => sum + billed, 0)

	return Math.round(total / window.length)
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

// The stderr line names the window the average covers, so the reader can tell a recent-tail average
// from a whole-session one (joshuafolkken/kit#2295): "the last W of T request(s)" reads W when the
// session is longer than the window and the whole count when it is shorter.
function over_summary(measurement: OverMeasurement, limit: number): string {
	const total = measurement.billed_input_per_request.length
	const window = recent_requests(measurement).length

	return `${String(per_request_cost(measurement))} billed input tokens per request over the last ${String(window)} of ${String(total)} request(s); limit ${String(limit)}`
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
