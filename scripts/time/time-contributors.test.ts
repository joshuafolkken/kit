import { describe, expect, it } from 'vitest'
import { time_contributors } from './time-contributors'
import { time_format } from './time-format'
import { time_parent_turns, type ParentTurnTotals } from './time-parent-turns'

// The turn breakdown aggregated across runs (joshuafolkken/kit#1763).

const { IMPLEMENTATION, INVESTIGATION, CONTRIBUTOR_NAMES } = time_parent_turns

const TEN = 10
const FOUR = 4

function measured(
	by_contributor: Readonly<Record<string, number>>,
	turn_count: number,
): ParentTurnTotals {
	return { turn_count, by_contributor, is_measured: true }
}

function unmeasured(): ParentTurnTotals {
	return { ...time_parent_turns.NO_PARENT_TURNS }
}

function row_of(totals: ReadonlyArray<ParentTurnTotals>, label: string): unknown {
	return time_contributors.contributor_rows(totals).find((row) => row.label === label)?.distribution
}

function line_with(totals: ReadonlyArray<ParentTurnTotals>, needle: string): string {
	const lines = time_contributors.contributor_lines(time_contributors.contributor_rows(totals))

	return lines.find((line) => line.includes(needle)) ?? ''
}

describe('time_contributors.contributor_rows', () => {
	// The acceptance criterion of the whole change at the level of one row: a run whose transcript was
	// never read is one fewer reading, never a reading of zero.
	it('excludes a run nothing was read for from the sample count', () => {
		const distribution = row_of(
			[measured({ [IMPLEMENTATION]: TEN }, TEN), unmeasured()],
			IMPLEMENTATION,
		)

		expect(distribution).toMatchObject({ sample_count: 1, median_ms: TEN, min_ms: TEN })
	})

	// The other half of that distinction, and the one a filter on the count rather than on the run
	// would get wrong: this run *was* read, and it issued no turn of this kind.
	it('counts a measured run that made no turn of a kind as a real zero', () => {
		const totals = [
			measured({ [IMPLEMENTATION]: TEN }, TEN),
			measured({ [INVESTIGATION]: FOUR }, FOUR),
		]

		expect(row_of(totals, IMPLEMENTATION)).toMatchObject({
			sample_count: 2,
			min_ms: 0,
			median_ms: TEN / 2,
			max_ms: TEN,
		})
	})

	it('prints one row per contributor, in the order one run reads them in', () => {
		const rows = time_contributors.contributor_rows([measured({ [IMPLEMENTATION]: TEN }, TEN)])

		expect(rows.map((row) => row.label)).toEqual([...CONTRIBUTOR_NAMES])
	})
})

describe('time_contributors.contributor_lines', () => {
	it('renders the median as a turn count with the range beside it', () => {
		const totals = [
			measured({ [IMPLEMENTATION]: TEN }, TEN),
			measured({ [INVESTIGATION]: FOUR }, FOUR),
		]

		expect(line_with(totals, IMPLEMENTATION)).toContain('0 – 10 · 2 run(s)')
	})

	// A turn count is not a duration, so the row must not arrive through the minutes formatter.
	it('does not print a turn count as minutes', () => {
		expect(line_with([measured({ [IMPLEMENTATION]: TEN }, TEN)], IMPLEMENTATION)).not.toContain(
			'min',
		)
	})

	it('says not measured where no run contributed a reading', () => {
		const line = line_with([unmeasured()], IMPLEMENTATION)

		expect(line).toContain(time_format.NOT_MEASURED)
	})
})

describe('time_contributors — two reads of the same input', () => {
	// What the hand count could not promise: the 2026-09-11 table and the next one took different
	// denominators and neither said which.
	it('gives the same rows and the same text both times', () => {
		const totals = [
			measured({ [IMPLEMENTATION]: TEN }, TEN),
			measured({ [INVESTIGATION]: FOUR }, FOUR),
			unmeasured(),
		]
		const first = time_contributors.contributor_rows(totals)
		const second = time_contributors.contributor_rows(totals)

		expect(second).toEqual(first)
		expect(time_contributors.contributor_lines(second)).toEqual(
			time_contributors.contributor_lines(first),
		)
	})
})
