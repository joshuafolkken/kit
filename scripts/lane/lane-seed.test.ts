import { describe, expect, it } from 'vitest'
import { lane_seed_policy } from './lane-seed'

// joshuafolkken/kit#1490: two lanes running E2E at once must not land on one port. A seed offsets
// dev (5173) and preview (4173) together, so one project's preview port equals another's dev port
// exactly when their seeds differ by 1000 — which the band below makes structurally impossible.

const ROOT_FILE = 'PORT_SEED=5\n'
const ROOT_SEED = 5
const EXPLICIT_BASE = 100
const PORT_BASE_DISTANCE = 1000

function every_seat(base: number): Array<number> {
	return Array.from({ length: lane_seed_policy.LAST_LANE_SEAT }, (_, offset) => base + offset + 1)
}

describe('allocating a lane seat', () => {
	// The main work tree keeps the base seed itself, so a project that never opens a lane stays on
	// exactly the ports it has today — 5173 / 4173 for the unset seed CI runs on.
	it('starts one above the base, so the main work tree keeps seat 0', () => {
		expect(lane_seed_policy.allocate_seed(ROOT_SEED, [])).toBe(ROOT_SEED + 1)
		expect(lane_seed_policy.FIRST_LANE_SEAT).toBeGreaterThan(0)
	})

	// Lowest-free rather than next-highest, and read from the live lanes: a counter would hand a
	// closed-and-reopened lane the seat a running lane is still using.
	it('reuses the lowest seed no open lane is holding', () => {
		expect(lane_seed_policy.allocate_seed(ROOT_SEED, [6, 8])).toBe(7)
		expect(lane_seed_policy.allocate_seed(ROOT_SEED, [7, 8])).toBe(6)
	})

	it('answers undefined when every seat is taken, rather than wrapping the band', () => {
		expect(lane_seed_policy.allocate_seed(ROOT_SEED, every_seat(ROOT_SEED))).toBeUndefined()
	})

	it('keeps the band narrower than the distance between the two port bases', () => {
		expect(lane_seed_policy.LAST_LANE_SEAT).toBeLessThan(PORT_BASE_DISTANCE)
		expect(lane_seed_policy.SEED_CEILING).toBe(PORT_BASE_DISTANCE)
	})
})

describe('the seed a lane is numbered from', () => {
	it('is the root own seed, so a lane never shares the root ports', () => {
		expect(lane_seed_policy.seed_base(ROOT_FILE, {})).toBe(ROOT_SEED)
	})

	it('takes an explicit base for a machine whose root seed is already crowded', () => {
		const environment = { [lane_seed_policy.LANE_SEED_BASE_KEY]: String(EXPLICIT_BASE) }

		expect(lane_seed_policy.seed_base(ROOT_FILE, environment)).toBe(EXPLICIT_BASE)
	})

	it('reads a blank explicit base as unset', () => {
		const environment = { [lane_seed_policy.LANE_SEED_BASE_KEY]: '  ' }

		expect(lane_seed_policy.seed_base(ROOT_FILE, environment)).toBe(ROOT_SEED)
	})

	// A base that high would put a lane on a seed of 1000 or more, where its preview port is another
	// project's dev port. Failing here is the point: the alternative is a collision nobody sees.
	it('fails loudly when the band would reach the ceiling, rather than allocating anyway', () => {
		const crowded = { [lane_seed_policy.LANE_SEED_BASE_KEY]: String(lane_seed_policy.SEED_CEILING) }

		expect(() => lane_seed_policy.seed_base('', crowded)).toThrow(/stay under 1000/u)
	})

	it('accepts the highest base whose whole band still fits under the ceiling', () => {
		const highest = String(lane_seed_policy.HIGHEST_USABLE_BASE)
		const environment = { [lane_seed_policy.LANE_SEED_BASE_KEY]: highest }
		const base = lane_seed_policy.seed_base('', environment)

		expect(lane_seed_policy.allocate_seed(base, every_seat(base).slice(0, -1))).toBe(
			lane_seed_policy.SEED_CEILING - 1,
		)
	})
})
