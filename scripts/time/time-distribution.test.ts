import { describe, expect, it } from 'vitest'
import { time_distribution } from './time-distribution'

// The three figures a set of readings is read as (joshuafolkken/kit#1312).

const ODD = [30, 10, 20]
const EVEN = [40, 10, 30, 20]

describe('time_distribution.build', () => {
	it('reports the smallest, the middle and the largest reading', () => {
		expect(time_distribution.build(ODD)).toEqual({
			sample_count: 3,
			min_ms: 10,
			median_ms: 20,
			p90_ms: 30,
			max_ms: 30,
		})
	})

	// The pair is averaged rather than one side picked: picking would make the median depend on which
	// side the implementation happens to favor, which with four readings a reader would see.
	it('averages the middle pair for an even number of readings', () => {
		expect(time_distribution.build(EVEN).median_ms).toBe(25)
	})

	// The acceptance criterion, at the level of one figure: nothing measured is not a measured zero.
	it('answers the withheld distribution rather than zeroes for no reading at all', () => {
		const empty = time_distribution.build([])

		expect(empty).toEqual(time_distribution.NOTHING_MEASURED)
		expect(time_distribution.is_measured(empty)).toBe(false)
	})

	it('calls a single reading a measured distribution of one', () => {
		const one = time_distribution.build([7])

		expect(time_distribution.is_measured(one)).toBe(true)
		expect(one).toEqual({ sample_count: 1, min_ms: 7, median_ms: 7, p90_ms: 7, max_ms: 7 })
	})

	// The input is whatever order the runs came in, so the sort is the function's own business.
	it('does not depend on the order the readings arrived in', () => {
		expect(time_distribution.build([20, 30, 10])).toEqual(time_distribution.build([10, 20, 30]))
	})
})

// The fourth figure, added when a per-round-trip spread needed to say whether its worst reading was
// alone (joshuafolkken/kit#1386).
describe('time_distribution.build — the ninetieth percentile', () => {
	// A hundred readings whose tail is one long one — the shape run #1379 had. The p90 is a tenth of
	// the max, which is the whole reason a mean cannot answer the question.
	it('reports it by nearest rank, apart from the largest reading', () => {
		const readings = [...Array.from({ length: 99 }, (_unused, index) => index + 1), 1000]
		const spread = time_distribution.build(readings)

		expect(spread.median_ms).toBe(50.5)
		expect(spread.p90_ms).toBe(90)
		expect(spread.max_ms).toBe(1000)
	})

	// **Not interpolated**, so the figure is always a reading the sample actually held. `ceil` also
	// keeps the rank inside the array for a sample of one, which is what a run with a single round trip
	// hands over.
	it('answers the largest reading for a sample too small to have a separate ninetieth', () => {
		expect(time_distribution.build([5, 9]).p90_ms).toBe(9)
		expect(time_distribution.build([7]).p90_ms).toBe(7)
	})
})

describe('time_distribution.by_median_desc', () => {
	it('ranks by the median, leaving an unmeasured row last', () => {
		const rows = [
			time_distribution.labeled('small', [1]),
			time_distribution.labeled('none', []),
			time_distribution.labeled('large', [100]),
		]

		expect(time_distribution.by_median_desc(rows).map((row) => row.label)).toEqual([
			'large',
			'small',
			'none',
		])
	})
})
