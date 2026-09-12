import { describe, expect, it } from 'vitest'
import {
	time_region_costs,
	type Bucket,
	type LabeledRegion,
	type PricedRequest,
} from './time-region-costs'

// joshuafolkken/kit#1872: the walk two cost blocks share — place a billed request in the stretch of
// wall clock that contains it, and add its dollars to that stretch's bucket. Tested on synthetic
// regions so the attribution is checked apart from either caller's way of building them.

const EARLY = 'a'
const LATE = 'b'

function region(start_ms: number, end_ms: number, label: string): LabeledRegion {
	return { start_ms, end_ms, label }
}

function at(at_ms: number | undefined, cost_usd: number, is_priced = true): PricedRequest {
	return { at_ms, cost_usd, is_priced }
}

const REGIONS: ReadonlyArray<LabeledRegion> = [region(0, 10, EARLY), region(10, 20, LATE)]

function bucket(counted: ReturnType<typeof time_region_costs.tally>, label: string): Bucket {
	return counted.by_label.get(label) ?? time_region_costs.EMPTY_BUCKET
}

describe('time_region_costs.tally — placing a request in the region that contains it', () => {
	it('charges a request to the region its instant falls inside', () => {
		const counted = time_region_costs.tally(REGIONS, [at(5, 2), at(15, 3)])

		expect([bucket(counted, EARLY).cost_usd, bucket(counted, LATE).cost_usd]).toEqual([2, 3])
	})

	it('adds the requests of one region into one bucket', () => {
		const counted = time_region_costs.tally(REGIONS, [at(2, 1), at(5, 1)])

		expect(bucket(counted, EARLY)).toEqual({ request_count: 2, cost_usd: 2 })
	})

	// Every assistant line closes a model span, so a request's instant sits on a boundary far more
	// often than inside one; the region that ends there wins.
	it('charges a boundary instant to the region that ends there', () => {
		const counted = time_region_costs.tally(REGIONS, [at(10, 4)])

		expect([bucket(counted, EARLY).request_count, bucket(counted, LATE).request_count]).toEqual([
			1, 0,
		])
	})

	it('sorts regions that arrive out of time order before matching', () => {
		const reversed = [region(10, 20, LATE), region(0, 10, EARLY)]
		const counted = time_region_costs.tally(reversed, [at(10, 4)])

		expect(bucket(counted, EARLY).request_count).toBe(1)
	})
})

describe('time_region_costs.tally — a request inside no region', () => {
	it('sends a request outside every region to the unattributed bucket', () => {
		const counted = time_region_costs.tally(REGIONS, [at(30, 5)])

		expect(counted.unattributed).toEqual({ request_count: 1, cost_usd: 5 })
	})

	it('sends a request whose instant could not be read to the same bucket', () => {
		const counted = time_region_costs.tally(REGIONS, [at(undefined, 3)])

		expect([counted.unattributed.request_count, counted.by_label.size]).toEqual([1, 0])
	})
})

describe('time_region_costs — the arithmetic', () => {
	it('sums request counts and dollars across buckets', () => {
		const total = time_region_costs.sum_of([
			{ request_count: 2, cost_usd: 3 },
			{ request_count: 1, cost_usd: 4 },
		])

		expect(total).toEqual({ request_count: 3, cost_usd: 7 })
	})

	it('counts the requests the price table could not cost', () => {
		expect(time_region_costs.unpriced_count([at(1, 0, false), at(2, 1)])).toBe(1)
	})
})
