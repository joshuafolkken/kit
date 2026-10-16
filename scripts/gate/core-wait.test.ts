import { lane_paths } from '#scripts/lane/lane-paths'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LedgerEntry } from './core-admission'
import { core_wait, type BudgetWait } from './core-wait'

// joshuafolkken/kit#3943: a claim the budget held back waited in silence, so a lane stalled on memory
// pressure read the same as a stuck one. What is pinned here is why a claim waits and which markers
// `run:board` draws as waiting.

const CORES = 4
const MEMORY_MB = 1000

function entry(key: string, weight: number, memory_mb: number): LedgerEntry {
	return { key, reservation: { weight, memory_mb, claimed_at: key === 'first' ? 0 : 1 } }
}

describe('core_wait.wait_reason — why a claim waits', () => {
	it('names the cores when the claim would not fit even with unlimited memory', () => {
		const ledger = [entry('first', CORES, 0), entry('second', 1, 0)]

		expect(core_wait.wait_reason('second', ledger, { cores: CORES, memory_mb: MEMORY_MB })).toBe(
			'cores',
		)
	})

	it('names the memory when the claim fits on cores alone', () => {
		const ledger = [entry('first', 1, MEMORY_MB), entry('second', 1, MEMORY_MB)]

		expect(core_wait.wait_reason('second', ledger, { cores: CORES, memory_mb: MEMORY_MB })).toBe(
			'memory',
		)
	})

	it('names the pressure when the reading saw compression or swap', () => {
		const ledger = [entry('first', 1, MEMORY_MB), entry('second', 1, MEMORY_MB)]
		const budget = { cores: CORES, memory_mb: 0, memory_pressured: true }

		expect(core_wait.wait_reason('second', ledger, budget)).toBe('pressure')
	})
})

describe('core_wait.wait_line — what a waiting command prints', () => {
	it('names the command and the reason', () => {
		expect(core_wait.wait_line('lint', 'pressure')).toBe(
			'⏳ lint waits for the core budget — memory under pressure',
		)
	})

	it('names a claim with no command as a step', () => {
		expect(core_wait.wait_line(undefined, 'cores')).toContain('a step waits')
	})
})

const NOW = 10_000
const HOME = '/dev/kit'
const HOME_LANE = '/dev/.kit-lanes/12'
const HERE = { lane: undefined, elsewhere: undefined }
const IN_LANE = { lane: '12', elsewhere: undefined }
const OTHER_MAIN = '/dev/app-kit'
const OTHER_LANE = '/dev/.app-kit-lanes/12'

beforeEach(() => {
	vi.stubEnv(lane_paths.LANE_ROOT_KEY, '')
})

afterEach(() => {
	vi.unstubAllEnvs()
})

// The claimer records where it runs under the default lanes root; `board_root` is the board's own
// `JOSH_LANE_ROOT`, which may differ.
function place(
	checkout: string,
	home: string = HOME,
	board_root = '',
): Pick<BudgetWait, 'lane' | 'elsewhere'> {
	const where = core_wait.where_of(checkout)

	vi.stubEnv(lane_paths.LANE_ROOT_KEY, board_root)
	const [wait] = core_wait.waits_of(
		[{ reservation: { claimed_at: 0, ...where, wait_reason: 'cores' } }],
		NOW,
		home,
	)

	return { lane: wait?.lane, elsewhere: wait?.elsewhere }
}

describe('core_wait.waits_of — the claims run:board draws as waiting', () => {
	it('draws the waiting markers longest first, with how long each has waited', () => {
		const waits = core_wait.waits_of(
			[
				{
					reservation: {
						claimed_at: 9000,
						command: 'lint',
						...core_wait.where_of(HOME_LANE),
						wait_reason: 'cores',
					},
				},
				{ reservation: { claimed_at: 4000, command: 'check', wait_reason: 'memory' } },
			],
			NOW,
			HOME,
		)

		expect(waits).toStrictEqual([
			{ command: 'check', ...HERE, waited_ms: 6000, reason: 'memory' },
			{ command: 'lint', ...IN_LANE, waited_ms: 1000, reason: 'cores' },
		])
	})

	it('leaves out an admitted marker and one that never waited', () => {
		const waits = core_wait.waits_of(
			[
				{ reservation: { claimed_at: 0, admitted_at: 1, wait_reason: 'cores' } },
				{ reservation: { claimed_at: 0 } },
			],
			NOW,
			HOME,
		)

		expect(waits).toStrictEqual([])
	})
})

// joshuafolkken/kit#3943 review: the ledger is machine-wide, so another repository's lane `12` was
// linked to this repository's issue 12.
describe('core_wait.waits_of — where a waiting claim runs', () => {
	it('places a checkout of the board repository as its lane, or none for its main checkout', () => {
		expect(place(HOME_LANE)).toStrictEqual(IN_LANE)
		expect(place(HOME)).toStrictEqual(HERE)
	})

	it('names another repository checkout instead of giving it a lane the board would link', () => {
		expect(place(OTHER_LANE)).toStrictEqual({
			lane: undefined,
			elsewhere: '.app-kit-lanes/12',
		})
		expect(place(OTHER_MAIN)).toStrictEqual({ lane: undefined, elsewhere: 'app-kit' })
	})

	it('places against the board repository when the board itself runs in a lane', () => {
		const board_lane = '/dev/.kit-lanes/7'

		expect(place(HOME, board_lane)).toStrictEqual(HERE)
		expect(place(HOME_LANE, board_lane)).toStrictEqual(IN_LANE)
	})

	it('places another repository by the lanes root it recorded, not the board JOSH_LANE_ROOT', () => {
		const board_root = '/lanes/kit'

		expect(place(OTHER_MAIN, HOME, board_root)).toStrictEqual({
			lane: undefined,
			elsewhere: 'app-kit',
		})
		expect(place(OTHER_LANE, HOME, board_root)).toMatchObject({ lane: undefined })
	})
})
