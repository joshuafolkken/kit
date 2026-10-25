// The tail of the period's lane times beside `lane:stats`'s median (joshuafolkken/kit#4910): a lane's
// target is a ceiling, so the lanes over the overrun threshold and the 90th percentile say what a median
// hides. The threshold is the one the overrun investigation launches past (`lane-overrun.ts`).

// The net minutes a lane may take before its causes are investigated.
const OVERRUN_LANE_MINUTES = 40
const TAIL_PERCENTILE = 90
const WHOLE_PERCENT = 100

function is_overrun(minutes: number): boolean {
	return minutes > OVERRUN_LANE_MINUTES
}

// The lanes over the threshold; one exactly at it is not over.
function overrun_count(minutes: ReadonlyArray<number>): number {
	return minutes.filter((value) => is_overrun(value)).length
}

// The nearest-rank 90th percentile, else `undefined` with no lane.
function tail_minutes(minutes: ReadonlyArray<number>): number | undefined {
	if (minutes.length === 0) return undefined

	const sorted = minutes.toSorted((left, right) => left - right)
	const rank = Math.ceil((TAIL_PERCENTILE / WHOLE_PERCENT) * sorted.length)

	return sorted[rank - 1]
}

const lane_tail_stats = { is_overrun, OVERRUN_LANE_MINUTES, overrun_count, tail_minutes }

export { lane_tail_stats }
