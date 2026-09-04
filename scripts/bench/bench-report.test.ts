import { time_distribution } from '#scripts/time/time-distribution'
import { describe, expect, it } from 'vitest'
import { bench_report, type BenchReading, type BenchSample } from './bench-report'

const LINT = 'lint'
const CHECK = 'check'
const UNIT = 'test:unit'
const ESLINT_CACHE = '.eslintcache'
const SECOND = 1000

function reading(cold_seconds: number, warm_seconds: number, is_failed = false): BenchReading {
	return { cold_ms: cold_seconds * SECOND, warm_ms: warm_seconds * SECOND, is_failed }
}

function sample(
	target: string,
	readings: ReadonlyArray<BenchReading>,
	caches: ReadonlyArray<string> = [ESLINT_CACHE],
): BenchSample {
	return { target, caches, readings }
}

function render(one: BenchSample): string {
	return bench_report.format_report(bench_report.build_report([one])).join('\n')
}

describe('bench aggregation — the cold-to-warm ratio', () => {
	it('reports how many times faster the warm reading was', () => {
		const cold = time_distribution.build([128_000])
		const warm = time_distribution.build([2900])

		expect(bench_report.speedup_of(cold, warm)).toBeCloseTo(44.14, 1)
	})

	// A warm reading that rounded to zero makes the ratio an artefact of the clock rather than a
	// measurement, so no number is the honest answer.
	it('refuses a ratio against a zero warm reading', () => {
		const cold = time_distribution.build([128_000])

		expect(bench_report.speedup_of(cold, time_distribution.build([0]))).toBeUndefined()
	})

	it('refuses a ratio where either phase was never measured', () => {
		const measured = time_distribution.build([128_000])
		const { NOTHING_MEASURED } = time_distribution

		expect(bench_report.speedup_of(NOTHING_MEASURED, measured)).toBeUndefined()
		expect(bench_report.speedup_of(measured, NOTHING_MEASURED)).toBeUndefined()
	})
})

describe('bench aggregation — one row per target', () => {
	// The median rather than the mean, and it is `time-distribution.ts`'s: one reading interrupted by
	// a background build moves a mean of three by seconds and a median not at all.
	it('carries the median of both phases and the ratio between them', () => {
		const row = bench_report.build_row(
			sample(LINT, [reading(120, 3), reading(400, 2), reading(128, 4)]),
		)

		expect(row.cold.median_ms).toBe(128 * SECOND)
		expect(row.warm.median_ms).toBe(3 * SECOND)
		expect(row.speedup).toBeCloseTo(42.7, 1)
		expect(row.cold.sample_count).toBe(3)
	})

	it('keeps the spread of the readings it aggregated', () => {
		const row = bench_report.build_row(sample(LINT, [reading(120, 3), reading(130, 5)]))

		expect(row.cold.min_ms).toBe(120 * SECOND)
		expect(row.cold.max_ms).toBe(130 * SECOND)
	})

	// A check that exits on its first error has measured how long it took to find that error, not
	// what the check costs — averaging it in is how a red tree comes to look like a cache win.
	it('excludes a failed reading from the figures and counts it', () => {
		const row = bench_report.build_row(sample(LINT, [reading(128, 3), reading(1, 1, true)]))

		expect(row.cold.median_ms).toBe(128 * SECOND)
		expect(row.failures).toBe(1)
		expect(row.cold.sample_count).toBe(1)
	})

	// Kept apart from a zero, which would be a claim that the command took no time.
	it('measures nothing where every reading failed', () => {
		const row = bench_report.build_row(sample(LINT, [reading(1, 1, true)]))

		expect(time_distribution.is_measured(row.cold)).toBe(false)
		expect(row.speedup).toBeUndefined()
	})
})

describe('bench report — order and notes', () => {
	it('puts the slowest cold command first, so the row worth acting on is read first', () => {
		const report = bench_report.build_report([
			sample(CHECK, [reading(5, 1)]),
			sample(LINT, [reading(128, 3)]),
		])

		expect(report.rows.map((row) => row.target)).toStrictEqual([LINT, CHECK])
	})

	it('sorts a target that measured nothing last rather than first', () => {
		const report = bench_report.build_report([
			sample(LINT, [reading(1, 1, true)]),
			sample(CHECK, [reading(5, 1)]),
		])

		expect(report.rows.map((row) => row.target)).toStrictEqual([CHECK, LINT])
	})

	it('names the target whose readings failed', () => {
		const report = bench_report.build_report([sample(LINT, [reading(1, 1, true)])])

		expect(report.notes.join('\n')).toContain('lint: 1 reading(s) exited non-zero')
	})

	it('keeps the notes it was handed alongside the ones it derives', () => {
		const report = bench_report.build_report([sample(LINT, [reading(1, 1, true)])], ['handed in'])

		expect(report.notes).toStrictEqual([
			'handed in',
			'lint: 1 reading(s) exited non-zero, excluded',
		])
	})
})

describe('bench report — what a rendered row says', () => {
	it('puts the cold figure in the numeric column and the rest beside it', () => {
		const rendered = render(sample(LINT, [reading(128.4, 2.9)]))

		expect(rendered).toContain(LINT)
		expect(rendered).toContain('128.4 s')
		expect(rendered).toContain('warm 2.9 s')
		expect(rendered).toContain(`cleared ${ESLINT_CACHE}`)
	})

	// A cold figure for a command that keeps no cache measures the operating system's page cache and
	// nothing else, and the row has to say so or it will be read as a cache win.
	it('says when no cache was cleared at all', () => {
		const uncached = sample(UNIT, [reading(18, 18)], [])

		expect(render(uncached)).toContain('no cache cleared')
	})

	// Noise on a target that clears no cache routinely puts the warm reading above the cold one, and
	// `0.9× faster` would assert a cache win the measurement contradicts.
	it('calls a warm run that came out slower a slowdown', () => {
		const noisy = sample(UNIT, [reading(18, 20)], [])

		expect(render(noisy)).toContain('1.1× slower')
	})

	it('prints a target that measured nothing as not measured', () => {
		const all_failed = sample(LINT, [reading(1, 1, true)])

		expect(render(all_failed)).toContain('not measured')
	})

	// A single reading has no spread, and printing one would suggest a range was measured.
	it('withholds the range until more than one cycle was run', () => {
		const one_cycle = sample(LINT, [reading(128, 3)])

		expect(render(one_cycle)).not.toContain('cycles')
	})

	it('reports the range of both phases once there is one', () => {
		const rendered = render(sample(LINT, [reading(120, 3), reading(130, 5)]))

		expect(rendered).toContain('2 cycles')
		expect(rendered).toContain('cold 120.0 s – 130.0 s')
		expect(rendered).toContain('warm 3.0 s – 5.0 s')
	})
})
