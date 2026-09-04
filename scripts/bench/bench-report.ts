import { time_distribution, type Distribution } from '#scripts/time/time-distribution'
import { time_format } from '#scripts/time/time-format'

// The aggregation `josh bench` prints: from a target's readings to one cold figure, one warm figure
// and the ratio between them (joshuafolkken/kit#1314).
//
// **This module runs no command.** Everything here is a pure function of readings already taken,
// which is what makes the acceptance criterion's unit tests possible at all: the execution is one
// child process per reading, and a suite that spawned them would measure the machine it ran on.
//
// **The two things it does not define itself are the two that already exist.** Several readings
// become min/median/max through `time-distribution.ts` — which also carries the distinction this
// report needs most, a sample nobody could take against a sample of zero — and the columns come from
// `time-format.ts`, as `layer-report.ts`'s do. A third median or a third set of width rules beside a
// third renderer is the clone `CLAUDE.md` prohibits.

const SPEEDUP_DECIMALS = 1
const NO_CACHE = 'no cache cleared'
const SINGLE_READING = 1
const NO_DIFFERENCE = 1
const RANGE_SEPARATOR = ' – '

// One clear-run-run cycle: the reading taken with the target's caches removed, and the one taken
// straight after with the caches the first run just wrote.
interface BenchReading {
	cold_ms: number
	warm_ms: number
	// Either half exiting non-zero. Carried per reading rather than per target so a run that failed
	// once out of three is reported as one failure instead of poisoning the whole row — a failing
	// check usually exits early, which makes its seconds a measurement of nothing.
	is_failed: boolean
}

interface BenchSample {
	target: string
	caches: ReadonlyArray<string>
	readings: ReadonlyArray<BenchReading>
}

interface BenchRow {
	target: string
	caches: ReadonlyArray<string>
	failures: number
	cold: Distribution
	warm: Distribution
	// How many times faster the warm run was. `undefined` where either phase was never measured, or
	// where the warm median rounded to zero and the ratio would be an artefact of the clock.
	speedup: number | undefined
}

interface BenchReport {
	rows: ReadonlyArray<BenchRow>
	notes: ReadonlyArray<string>
}

// **Both medians are guarded, not just the divisor.** A zero on either side makes the ratio an
// artefact of the clock rather than a measurement — and a zero cold median renders as
// `Infinity× slower`, which is worse than no answer.
function speedup_of(cold: Distribution, warm: Distribution): number | undefined {
	if (!time_distribution.is_measured(cold) || !time_distribution.is_measured(warm)) return undefined
	if (warm.median_ms === 0 || cold.median_ms === 0) return undefined

	return cold.median_ms / warm.median_ms
}

// **A failed reading is excluded from the figures, not counted as a fast one.** A check that exits
// on its first error has measured how long it took to find that error, which is not the cost of the
// check — and averaging it in is how a red tree comes to look like a cache win.
function passed_readings(sample: BenchSample): ReadonlyArray<BenchReading> {
	return sample.readings.filter((reading) => !reading.is_failed)
}

function build_row(sample: BenchSample): BenchRow {
	const passed = passed_readings(sample)
	const cold = time_distribution.build(passed.map((reading) => reading.cold_ms))
	const warm = time_distribution.build(passed.map((reading) => reading.warm_ms))

	return {
		target: sample.target,
		caches: sample.caches,
		failures: sample.readings.length - passed.length,
		cold,
		warm,
		speedup: speedup_of(cold, warm),
	}
}

// Slowest cold first, so the row worth acting on is the first one read — `layer-report.ts` orders its
// own table on the same principle, and `time_distribution.by_median_desc` on the same figure. A row
// nobody could measure has a zero median and sorts to the bottom, which is where it belongs.
function by_cold_cost(left: BenchRow, right: BenchRow): number {
	return right.cold.median_ms - left.cold.median_ms
}

function failure_notes(rows: ReadonlyArray<BenchRow>): Array<string> {
	return rows
		.filter((row) => row.failures > 0)
		.map((row) => `${row.target}: ${String(row.failures)} reading(s) exited non-zero, excluded`)
}

function build_report(
	samples: ReadonlyArray<BenchSample>,
	notes: ReadonlyArray<string> = [],
): BenchReport {
	const rows = samples.map((sample) => build_row(sample)).toSorted(by_cold_cost)

	return { rows, notes: [...notes, ...failure_notes(rows)] }
}

// **A ratio below one is a slowdown and says so.** `speedup_of` is cold ÷ warm, so noise on a target
// that clears no cache routinely puts the warm reading above the cold one — and `0.9× faster` would
// assert a cache win the measurement contradicts.
function format_speedup(speedup: number | undefined): string {
	if (speedup === undefined) return 'n/a'
	if (speedup >= NO_DIFFERENCE) return `${speedup.toFixed(SPEEDUP_DECIMALS)}× faster`

	return `${(NO_DIFFERENCE / speedup).toFixed(SPEEDUP_DECIMALS)}× slower`
}

// What was cleared is part of the answer, not decoration: a cold figure means one thing where a
// cache was emptied and quite another where the target keeps none.
function format_cleared(caches: ReadonlyArray<string>): string {
	return caches.length === 0 ? NO_CACHE : `cleared ${caches.join(', ')}`
}

function phase_range(phase: Distribution): string {
	return [phase.min_ms, phase.max_ms]
		.map((ms) => time_format.format_seconds(ms))
		.join(RANGE_SEPARATOR)
}

// The range rides at the end and only where more than one cycle was run — a single reading has no
// spread, and printing `3.8 s – 3.8 s` beside it would suggest one was measured. Three items rather
// than one sentence, so the caller's separator punctuates them like every other fact in the column.
function format_spread(cold: Distribution, warm: Distribution): Array<string> {
	if (cold.sample_count <= SINGLE_READING) return []

	return [
		`${String(cold.sample_count)} cycles`,
		`cold ${phase_range(cold)}`,
		`warm ${phase_range(warm)}`,
	]
}

function format_row(row: BenchRow): string {
	if (!time_distribution.is_measured(row.cold)) return time_format.unmeasured_row(row.target)

	const suffix = [
		`warm ${time_format.format_seconds(row.warm.median_ms)}`,
		format_speedup(row.speedup),
		format_cleared(row.caches),
		...format_spread(row.cold, row.warm),
	].join(time_format.SUFFIX_SEPARATOR)

	return time_format.format_columns(
		row.target,
		time_format.format_seconds(row.cold.median_ms),
		suffix,
	)
}

// **The heading counts what was measured, not what was attempted.** A run on a red tree renders every
// row as `not measured` and exits non-zero; a heading counting rows would still announce two commands
// measured, contradicting both the body and the exit code. The predicate is the one the exit code
// uses, so the two cannot come to disagree.
function measured_count(report: BenchReport): number {
	return report.rows.filter((row) => time_distribution.is_measured(row.cold)).length
}

function format_report(report: BenchReport): Array<string> {
	return [
		`Cold and warm cost — ${String(measured_count(report))} command(s) measured`,
		'',
		...report.rows.slice(0, time_format.MAX_ROWS).map((row) => format_row(row)),
		...time_format.overflow_line(report.rows.length),
		...(report.notes.length === 0 ? [] : ['']),
		...time_format.note_lines(report.notes),
	]
}

const bench_report = { build_report, build_row, format_report, measured_count, speedup_of }

export type { BenchReading, BenchReport, BenchRow, BenchSample }
export { bench_report }
