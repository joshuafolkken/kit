// The three figures a set of runs is read as, rather than the one figure a single run gives
// (joshuafolkken/kit#1312).
//
// `.claude/skills/diag/SKILL.md` already says "one run is not a sample — where two runs disagree, say
// so", and nothing in `josh time` could produce the spread that sentence asks for. The 2026-09-04
// `diag` assembled it by hand: five `--issue` calls, the rows lined up in a text editor, and two
// verdicts left as "cannot tell" with no way to say whether that was variance or too few readings.
//
// **Min, median and max rather than a mean and a deviation.** The question is whether an effect is
// larger than the spread, and the three endpoints answer it without assuming a distribution five
// readings could never establish. The median is the middle reading rather than the average, so one
// outlying run moves it by at most one position — which a mean of five does not promise.
//
// **A sample nobody could take is not a sample of zero.** `sample_count` is the whole of that
// distinction: a phase never detected, a check no run ran, a transcript that could not be read all
// answer with the empty distribution, and the renderer prints `not measured` rather than `0.0 min`.

const NO_SAMPLES = 0
const HALF = 2
// The rank the fourth figure is read at. A tenth of the sample sits at or above it, which is the
// share a reader is asking about when they ask how bad the tail gets.
const P90_RANK = 0.9

interface Distribution {
	// How many runs this figure was read from. Never assume it equals the number of runs measured: a
	// phase absent from two of five runs is three samples, and saying which is the point of the field.
	sample_count: number
	min_ms: number
	median_ms: number
	// The ninetieth percentile (joshuafolkken/kit#1386). The median says what a typical reading was and
	// the max says what the worst one was; only this says whether the worst one was alone. It joined
	// the shape rather than being computed beside it, because a second percentile helper next to the
	// one caller that wanted it is the clone `CLAUDE.md` prohibits — and the two would then disagree
	// about what an even-sized sample's middle is.
	p90_ms: number
	max_ms: number
}

const NOTHING_MEASURED: Distribution = {
	sample_count: NO_SAMPLES,
	min_ms: 0,
	median_ms: 0,
	p90_ms: 0,
	max_ms: 0,
}

// The middle reading, or the mean of the middle pair for an even count. **The pair is averaged rather
// than one of the two picked**, because picking would make the median depend on which side the
// implementation happens to favor — and with four readings that is a difference a reader would see.
function median_of(sorted: ReadonlyArray<number>): number {
	const middle = Math.floor(sorted.length / HALF)
	const upper = sorted[middle] ?? 0

	if (sorted.length % HALF === 1) return upper

	return (upper + (sorted[middle - 1] ?? 0)) / HALF
}

// **By nearest rank, never interpolated.** The figure is read as a reading the sample actually held —
// a reader who sees `p90 17.1 s` goes looking for the turn behind it — and an interpolated percentile
// is a number no reading ever took. `Math.ceil` puts a sample of one at its only reading rather than
// below the array.
function p90_of(sorted: ReadonlyArray<number>): number {
	const rank = Math.ceil(sorted.length * P90_RANK) - 1

	return sorted[Math.max(rank, 0)] ?? 0
}

// **An empty input answers the withheld distribution, never a zeroed one.** The two are told apart by
// `sample_count` alone, and every renderer of this record is required to read it before printing a
// number.
function build(values: ReadonlyArray<number>): Distribution {
	if (values.length === NO_SAMPLES) return NOTHING_MEASURED

	const sorted = values.toSorted((left, right) => left - right)

	return {
		sample_count: sorted.length,
		min_ms: sorted[0] ?? 0,
		median_ms: median_of(sorted),
		p90_ms: p90_of(sorted),
		max_ms: sorted.at(-1) ?? 0,
	}
}

function is_measured(distribution: Distribution): boolean {
	return distribution.sample_count > NO_SAMPLES
}

// A distribution and what it is a distribution of. The label is carried beside the figures rather
// than kept in a parallel array, so a table cannot come to print one row's name against another's
// spread.
interface LabeledDistribution {
	label: string
	distribution: Distribution
}

function labeled(label: string, values: ReadonlyArray<number>): LabeledDistribution {
	return { label, distribution: build(values) }
}

// Heaviest first, which is the order every other table in this report is in. **Ranked by the median
// rather than by the max**, because one long run is what the spread exists to expose rather than what
// should decide the ordering; a row nobody measured sorts to the bottom because its median is zero,
// which is where a `not measured` row belongs.
function by_median_desc(rows: ReadonlyArray<LabeledDistribution>): Array<LabeledDistribution> {
	return rows.toSorted((left, right) => right.distribution.median_ms - left.distribution.median_ms)
}

const time_distribution = {
	NOTHING_MEASURED,
	build,
	is_measured,
	labeled,
	by_median_desc,
}

export type { Distribution, LabeledDistribution }
export { time_distribution }
