import { describe, expect, it } from 'vitest'
import { lane_capacity } from './lane-capacity'

// joshuafolkken/kit#1491: how many lanes a repository may run at once. The limit is a ceiling rather
// than a prediction, so the tests are about what the number refuses, never about what it promises.

const { LANE_LIMIT_KEY } = lane_capacity
const DEFAULT_LIMIT = 6
const CONFIGURED_LIMIT = 3
const NO_LANES = 0
const OCCUPIED_LANES = 2
const REMAINING_LANES = DEFAULT_LIMIT - OCCUPIED_LANES

function environment(value: string | undefined): Record<string, string | undefined> {
	return { [LANE_LIMIT_KEY]: value }
}

describe('lane_capacity.lane_limit', () => {
	// The documented default. Asserted against a literal rather than against the constant it reads,
	// so a change to the number is a change to this test — which is what "documented" means here.
	it('is six when the variable is unset', () => {
		expect(lane_capacity.lane_limit(environment(undefined))).toEqual({
			kind: 'limit',
			limit: DEFAULT_LIMIT,
		})
	})

	// Blank is the shape an `.env.example` key ships in, so it is unset rather than invalid — the
	// reading `lane_paths.lane_root` already applies to `JOSH_LANE_ROOT`.
	it('is six when the variable is blank', () => {
		expect(lane_capacity.lane_limit(environment('  '))).toEqual({
			kind: 'limit',
			limit: DEFAULT_LIMIT,
		})
	})

	it('takes the configured number', () => {
		const configured = environment(String(CONFIGURED_LIMIT))

		expect(lane_capacity.lane_limit(configured)).toEqual({ kind: 'limit', limit: CONFIGURED_LIMIT })
	})
})

// An invalid value is a hard error rather than a silent fall back, the rule `PORT_SEED` already
// holds to: a typo that quietly becomes the default is a limit nobody chose, and the setting exists
// precisely so the number is the one a person chose.
describe('lane_capacity.lane_limit — a value that is not a limit', () => {
	it('refuses a value that is not a number', () => {
		expect(lane_capacity.lane_limit(environment('six')).kind).toBe('problem')
	})

	it('refuses zero, which would offer nothing forever', () => {
		expect(lane_capacity.lane_limit(environment('0')).kind).toBe('problem')
	})

	it('refuses a negative number', () => {
		expect(lane_capacity.lane_limit(environment('-2')).kind).toBe('problem')
	})

	it('names the variable and the value in the problem', () => {
		const choice = lane_capacity.lane_limit(environment('six'))

		expect(choice.kind === 'problem' && choice.problem).toContain(LANE_LIMIT_KEY)
		expect(choice.kind === 'problem' && choice.problem).toContain('six')
	})
})

describe('lane_capacity.free_lanes', () => {
	it('is the whole limit when nothing is running', () => {
		expect(lane_capacity.free_lanes(DEFAULT_LIMIT, NO_LANES)).toBe(DEFAULT_LIMIT)
	})

	it('is what is left when some lanes are occupied', () => {
		expect(lane_capacity.free_lanes(DEFAULT_LIMIT, OCCUPIED_LANES)).toBe(REMAINING_LANES)
	})

	it('is none when the limit is reached', () => {
		expect(lane_capacity.free_lanes(DEFAULT_LIMIT, DEFAULT_LIMIT)).toBe(NO_LANES)
	})

	// A repository holding more than the limit — the limit was lowered, or a stale label outlived its
	// run — has no free lane. A negative count read as "how many to offer" is a slice nobody meant.
	it('is never negative when more is occupied than the limit allows', () => {
		expect(lane_capacity.free_lanes(CONFIGURED_LIMIT, DEFAULT_LIMIT)).toBe(NO_LANES)
	})
})
