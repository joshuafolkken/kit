import { describe, expect, it } from 'vitest'
import { lane_seed_policy } from './lane-seed'

// joshuafolkken/kit#1494: a lane holds a seat (1..9), the units digit of the offset `seed × 10 +
// seat`. The seed carries the band, so the seat needs no ceiling of its own — only the lowest-free
// choice, read from the live lanes, and an honest empty result when all nine are taken.

const NO_SEATS_TAKEN: ReadonlyArray<number> = []

function every_seat(): Array<number> {
	return Array.from(
		{ length: lane_seed_policy.LAST_LANE_SEAT },
		(_, index) => lane_seed_policy.FIRST_LANE_SEAT + index,
	)
}

describe('the free lane seats', () => {
	// The main work tree is seat 0, so a lane never takes it: allocation starts at seat 1.
	it('starts at seat 1, so the main work tree keeps seat 0', () => {
		expect(lane_seed_policy.free_seats(NO_SEATS_TAKEN)[0]).toBe(1)
		expect(lane_seed_policy.FIRST_LANE_SEAT).toBe(1)
	})

	it('offers every seat when none is taken, lowest first', () => {
		expect(lane_seed_policy.free_seats(NO_SEATS_TAKEN)).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
	})

	// Lowest-free rather than next-highest, and read from the live lanes: a counter would hand a
	// closed-and-reopened lane the seat a running lane is still using.
	it('omits the seats open lanes hold, keeping the rest lowest first', () => {
		expect(lane_seed_policy.free_seats([6, 8])).toStrictEqual([1, 2, 3, 4, 5, 7, 9])
		expect(lane_seed_policy.free_seats([1, 2])[0]).toBe(3)
	})

	it('offers nothing when every seat is taken, rather than wrapping', () => {
		expect(lane_seed_policy.free_seats(every_seat())).toStrictEqual([])
	})

	it('never offers a seat past the last one', () => {
		expect(lane_seed_policy.LAST_LANE_SEAT).toBe(9)
		expect(lane_seed_policy.free_seats(NO_SEATS_TAKEN).at(-1)).toBe(lane_seed_policy.LAST_LANE_SEAT)
	})
})
