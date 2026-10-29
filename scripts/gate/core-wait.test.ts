import { lane_paths } from '#scripts/lane/lane-paths'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { busy_average } from './busy-average'
import type { LedgerEntry } from './core-admission'
import { core_wait, type BudgetWait } from './core-wait'

// joshuafolkken/kit#3943: a claim the budget held back waited in silence, so a lane stalled on memory
// pressure read the same as a stuck one. What is pinned here is why a claim waits and which markers
// `run:board` draws as waiting.

const CORES = 4
const MEMORY_MB = 1000

// A claim past the window a lighter one may pass it in (`core_admission`'s 30 s), so `second` queues.
const LONG_AGO = -60_000

// `first` is running; every other entry is still waiting.
function entry(key: string, weight: number, memory_mb: number): LedgerEntry {
	const claimed_at = key === 'first' ? 0 : 1
	const admitted_at = key === 'first' ? 0 : undefined

	return { key, reservation: { weight, memory_mb, claimed_at, admitted_at } }
}

function waiter_ahead(weight: number): LedgerEntry {
	return { key: 'ahead', reservation: { weight, memory_mb: 0, claimed_at: LONG_AGO } }
}

describe('core_wait.wait_reason — why a claim waits', () => {
	it('names the cores when the claim would not fit even with unlimited memory', () => {
		const ledger = [entry('first', CORES, 0), entry('second', 1, 0)]

		expect(core_wait.wait_reason('second', ledger, { cores: CORES, memory_mb: MEMORY_MB })).toBe(
			'cores',
		)
	})

	// joshuafolkken/kit#4238: the ledger's reservations fit, but busy load beyond them took the cores. The
	// first waiter is not held by that load (#4313), so the claim waits behind another one.
	it('names the CPU when the claim fits on what the ledger declares', () => {
		const ledger = [entry('first', CORES - 2, 0), waiter_ahead(1), entry('second', 1, 0)]
		const budget = { cores: CORES - 1, memory_mb: MEMORY_MB, busy_excess: 1 }

		expect(core_wait.wait_reason('second', ledger, budget)).toBe('cpu')
	})

	it('names the cores when the claim would not fit on what the ledger declares either', () => {
		const ledger = [entry('first', CORES, 0), waiter_ahead(1), entry('second', 1, 0)]
		const budget = { cores: CORES - 1, memory_mb: MEMORY_MB, busy_excess: 1 }

		expect(core_wait.wait_reason('second', ledger, budget)).toBe('cores')
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

// joshuafolkken/kit#4167: a unit claim the budget admits only below half its width still waits.
describe('core_wait.hold_reason — whether an admitted claim still waits', () => {
	const ledger: Array<LedgerEntry> = [
		{ key: 'own', reservation: { weight: CORES, claimed_at: 0, is_unit: true } },
	]
	const budget = { cores: CORES, memory_mb: MEMORY_MB }
	// Busy load beyond the ledger leaves the claim alone in it one core.
	const busy = { cores: 1, memory_mb: MEMORY_MB, busy_excess: CORES - 1 }

	it('holds a claim granted below half its width, on the CPU', () => {
		expect(core_wait.hold_reason('own', ledger, busy, 1)).toBe('cpu')
	})

	it('admits a claim granted half its width or more', () => {
		expect(core_wait.hold_reason('own', ledger, budget, CORES / 2)).toBeUndefined()
	})
})

// joshuafolkken/kit#4982: a wait whose load does not ease ends early only where that load is outside
// the ledger; the ledger's own claims give their room back.
describe('core_wait.is_outside_held — whether only load outside the ledger holds a claim', () => {
	const own: LedgerEntry = {
		key: 'own',
		reservation: { weight: CORES, claimed_at: 0, is_unit: true },
	}

	it('answers yes for a claim busy load beyond the ledger narrows', () => {
		const busy = { cores: 1, memory_mb: MEMORY_MB, busy_excess: CORES - 1 }

		expect(core_wait.is_outside_held('own', [own], busy)).toBe(true)
	})

	it('answers yes for a claim an overloaded run queue holds', () => {
		const lone = { ...own, reservation: { weight: 1, claimed_at: 0 } }
		const overloaded = { cores: CORES, memory_mb: MEMORY_MB, is_overloaded: true }

		expect(core_wait.is_outside_held('own', [lone], overloaded)).toBe(true)
	})

	it('answers no for a claim the running claims hold', () => {
		const ledger = [entry('first', CORES, 0), entry('second', 1, 0)]

		expect(
			core_wait.is_outside_held('second', ledger, { cores: CORES, memory_mb: MEMORY_MB }),
		).toBe(false)
	})
})

// joshuafolkken/kit#5391: a small claim other lanes' ledger claims hold waited out the cap on a machine
// whose measured load left it room.
const FREE_BUDGET = { cores: CORES, memory_mb: MEMORY_MB }
// Past the reading's averaging window since `first` was admitted, so the mean shows its load.
const READ_AT = busy_average.AVERAGE_WINDOW_MS
const IDLE = { busy_cores: 1, cores: CORES, now: READ_AT }

// `second`, of `weight`, waiting behind `first`, which reserves every core.
function held(weight: number): Array<LedgerEntry> {
	return [entry('first', CORES, 0), entry('second', weight, 0)]
}

describe('core_wait.is_held_in_vain — whether waiting on gains a claim nothing', () => {
	const budget = FREE_BUDGET
	const now = READ_AT
	const idle = IDLE

	it('answers yes for a small claim only the ledger holds while the machine has room', () => {
		expect(core_wait.is_held_in_vain('second', held(1), budget, idle)).toBe(true)
	})

	it('answers no once the measured load leaves no room for the claim', () => {
		const saturated = { busy_cores: CORES, cores: CORES, now }

		expect(core_wait.is_held_in_vain('second', held(1), budget, saturated)).toBe(false)
	})

	it('answers no where the machine could not be read', () => {
		const unread = { busy_cores: undefined, cores: CORES, now }

		expect(core_wait.is_held_in_vain('second', held(1), budget, unread)).toBe(false)
	})

	it('answers no on an overloaded run queue', () => {
		const overloaded = { ...budget, is_overloaded: true }

		expect(core_wait.is_held_in_vain('second', held(1), overloaded, idle)).toBe(false)
	})

	it('answers no for a claim heavier than a static check', () => {
		expect(core_wait.is_held_in_vain('second', held(CORES - 1), budget, idle)).toBe(false)
	})
})

describe('core_wait.is_held_in_vain — load the reading does not show yet', () => {
	// A claim released a poll ago runs, but the mean does not show it yet: the next one counts it.
	it('answers no once a claim admitted within the averaging window takes the room', () => {
		const fresh: LedgerEntry = {
			key: 'fresh',
			reservation: { weight: CORES - 1, claimed_at: 0, admitted_at: READ_AT - 1 },
		}

		expect(core_wait.is_held_in_vain('second', [...held(1), fresh], FREE_BUDGET, IDLE)).toBe(false)
	})

	it('answers yes once that claim is past the averaging window', () => {
		const shown: LedgerEntry = {
			key: 'shown',
			reservation: { weight: CORES - 1, claimed_at: 0, admitted_at: 0 },
		}

		expect(core_wait.is_held_in_vain('second', [...held(1), shown], FREE_BUDGET, IDLE)).toBe(true)
	})

	it('answers no for a small claim memory holds as well', () => {
		const ledger = [entry('first', CORES, MEMORY_MB), entry('second', 1, MEMORY_MB)]

		expect(core_wait.is_held_in_vain('second', ledger, FREE_BUDGET, IDLE)).toBe(false)
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

	// joshuafolkken/kit#4617 review: a claim from a Claude Code worktree recorded the lane as its root.
	it.each([[HOME_LANE], [HOME]])(
		'places a Claude Code worktree under %s as the checkout that holds it',
		(checkout) => {
			const nested = `${checkout}/.claude/worktrees/agent-a1`

			expect(place(nested)).toStrictEqual(place(checkout))
		},
	)

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
