import { describe, expect, it } from 'vitest'
import { lane_capacity } from './lane-capacity'

// joshuafolkken/kit#1491: how many lanes a repository may run at once. The limit is a ceiling rather
// than a prediction, so the tests are about what the number refuses, never about what it promises.

const { LANE_LIMIT_KEY } = lane_capacity
const DEFAULT_LIMIT = 6
const CONFIGURED_LIMIT = 3
const OVERRIDE_LIMIT = 8
const NO_LANES = 0
const OCCUPIED_LANES = 2
const REMAINING_LANES = DEFAULT_LIMIT - OCCUPIED_LANES
const LANE_SEATS = 9
const LIMIT_ABOVE_SEATS = 12

function environment(value: string | undefined): Record<string, string | undefined> {
	return { [LANE_LIMIT_KEY]: value }
}

async function no_override(): Promise<number | undefined> {
	return undefined
}

async function override(): Promise<number | undefined> {
	return OVERRIDE_LIMIT
}

async function limit_of(value: string | undefined): ReturnType<typeof lane_capacity.lane_limit> {
	return await lane_capacity.lane_limit(environment(value), no_override)
}

describe('lane_capacity.lane_limit', () => {
	// The documented default. Asserted against a literal rather than against the constant it reads,
	// so a change to the number is a change to this test — which is what "documented" means here.
	it('is six when the variable is unset', async () => {
		await expect(limit_of(undefined)).resolves.toEqual({ kind: 'limit', limit: DEFAULT_LIMIT })
	})

	// Blank is the shape an `.env.example` key ships in, so it is unset rather than invalid — the
	// reading `lane_paths.lane_root` already applies to `JOSH_LANE_ROOT`.
	it('is six when the variable is blank', async () => {
		await expect(limit_of('  ')).resolves.toEqual({ kind: 'limit', limit: DEFAULT_LIMIT })
	})

	it('takes the configured number', async () => {
		await expect(limit_of(String(CONFIGURED_LIMIT))).resolves.toEqual({
			kind: 'limit',
			limit: CONFIGURED_LIMIT,
		})
	})
})

// joshuafolkken/kit#3434: a running parent keeps the environment it started with, so the live run's
// `lane:limit` override is the only way its limit moves.
describe('lane_capacity.lane_limit — a live run override', () => {
	it('takes the override over the configured number', async () => {
		const choice = await lane_capacity.lane_limit(environment(String(CONFIGURED_LIMIT)), override)

		expect(choice).toEqual({ kind: 'limit', limit: OVERRIDE_LIMIT })
	})

	it('takes the override over a variable that is not a limit', async () => {
		const choice = await lane_capacity.lane_limit(environment('six'), override)

		expect(choice).toEqual({ kind: 'limit', limit: OVERRIDE_LIMIT })
	})
})

// An invalid value is a hard error rather than a silent fall back, the rule `PORT_SEED` already
// holds to: a typo that quietly becomes the default is a limit nobody chose, and the setting exists
// precisely so the number is the one a person chose.
describe('lane_capacity.lane_limit — a value that is not a limit', () => {
	it('refuses a value that is not a number', async () => {
		await expect(limit_of('six')).resolves.toMatchObject({ kind: 'problem' })
	})

	it('refuses zero, which would offer nothing forever', async () => {
		await expect(limit_of('0')).resolves.toMatchObject({ kind: 'problem' })
	})

	it('refuses a negative number', async () => {
		await expect(limit_of('-2')).resolves.toMatchObject({ kind: 'problem' })
	})

	it('names the variable and the value in the problem', async () => {
		const choice = await limit_of('six')

		expect(choice.kind === 'problem' && choice.problem).toContain(LANE_LIMIT_KEY)
		expect(choice.kind === 'problem' && choice.problem).toContain('six')
	})
})

describe('lane_capacity.read_limit', () => {
	it('names the given name in the problem', () => {
		const choice = lane_capacity.read_limit('0', '<limit>')

		expect(choice.kind === 'problem' && choice.problem).toContain('<limit>')
	})
})

describe('lane_capacity.seated_limit', () => {
	it('keeps a limit within the seats', () => {
		expect(lane_capacity.seated_limit(OVERRIDE_LIMIT)).toBe(OVERRIDE_LIMIT)
	})

	it('caps a limit above the seats at the seats', () => {
		expect(lane_capacity.seated_limit(LIMIT_ABOVE_SEATS)).toBe(LANE_SEATS)
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

	// joshuafolkken/kit#3027: `lane:open` refuses past the nine seats whatever the limit says.
	it('caps a limit above the seat count at the seats', () => {
		expect(lane_capacity.free_lanes(LIMIT_ABOVE_SEATS, NO_LANES)).toBe(LANE_SEATS)
		expect(lane_capacity.free_lanes(LIMIT_ABOVE_SEATS, LANE_SEATS)).toBe(NO_LANES)
	})
})
