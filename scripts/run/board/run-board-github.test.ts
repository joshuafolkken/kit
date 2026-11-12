import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it, vi } from 'vitest'
import type { ClosedIssue } from './run-board-closed'
import { run_board_fixture } from './run-board-fixture'
import { run_board_github, type Gather } from './run-board-github'
import type { BoardLanes } from './run-board-lane-state'
import type { BoardPlan } from './run-board-layout'
import type { LocalRead } from './run-board-read'
import type { GithubRateLimit } from './run-board-render-quota-github'
import { run_board_state, type BoardState, type Pace } from './run-board-state'
import type { ItemStatus } from './run-board-status'

const { LOCAL, START, harness, plan_titled } = run_board_fixture
const { PLAN_RETRY_MS, gather_github } = run_board_github
const { FRESH_STATE } = run_board_state

// A read that never answers.
async function never(): Promise<undefined> {
	return await new Promise(() => undefined)
}

function gather_of(plans: Array<BoardPlan | undefined>, pace: Pace): Gather {
	return { ports: harness(LOCAL, plans).ports, local: LOCAL, now_ms: START, pace }
}

describe('run_board_github.gather_github', () => {
	it('waits for the plan and folds it in at the settled pace', async () => {
		const state = await gather_github(FRESH_STATE, gather_of([plan_titled('a')], 'settled'))

		expect(state.plan?.context.titles.get(1)).toBe('a')
		expect(state.fetched_ms).toBe(START)
		expect(state.plan_fetch).toBeUndefined()
	})

	it('launches the plan read and returns without it in the background', async () => {
		const gather = gather_of([], 'background')
		const state = await gather_github(FRESH_STATE, {
			...gather,
			ports: { ...gather.ports, read_plan: never },
		})

		expect(state.plan).toBeUndefined()
		expect(state.plan_fetch?.answer()).toBeUndefined()
		expect(state.attempted_ms).toBe(START)
	})

	it('records when a failed plan read was asked', async () => {
		const state = await gather_github(FRESH_STATE, gather_of([undefined], 'settled'))

		expect(state.plan).toBeUndefined()
		expect(state.failed_ms).toBe(START)
	})

	it('does not launch a second plan read while one is in flight', async () => {
		const gather = gather_of([], 'background')
		const ports = { ...gather.ports, read_plan: never }
		const first = await gather_github(FRESH_STATE, { ...gather, ports })
		const second = await gather_github(first, { ...gather, ports })

		expect(second.plan_fetch).toBe(first.plan_fetch)
	})
})

// joshuafolkken/kit#4577: a lane on an issue the plan has no title for is read for at once, not after
// the retry interval — once per lane, since the read is asked after the lane started.
const UNTITLED = 4572
const TITLED = 1
const READ_STATE = {
	...FRESH_STATE,
	plan: plan_titled('a'),
	attempted_ms: START,
	fetched_ms: START,
}

function lane_gather(issue: number, started_ms: number, now_ms: number): Gather {
	const own = new Map([[issue, { state: 'running' as const, started_ms }]])
	const lane_states: BoardLanes = { own, earlier: new Map(), unknown: [] }
	const local: LocalRead = { ...LOCAL, lane_states }

	return { ports: harness(local, [plan_titled('a')]).ports, local, now_ms, pace: 'settled' }
}

const CACHED_CLOSED: ClosedIssue = {
	title: 'a',
	labels: [],
	closed_ms: START + 1,
	is_merged: false,
	is_not_planned: false,
}

function outcome_cache(closed: ClosedIssue, gather: Gather): BoardState {
	const { plan } = READ_STATE

	return {
		...READ_STATE,
		attempted_ms: gather.now_ms,
		plan: { ...plan, context: { ...plan.context, open_numbers: new Set() } },
		closed: new Map([[UNTITLED, closed]]),
		closed_attempted_ms: START,
		closed_asked: new Set([UNTITLED]),
	}
}

describe('run_board_github — missing outcome cache', () => {
	it.each([false, true])('retries a missing conclusion, merged %s', async (is_merged) => {
		const gather = lane_gather(UNTITLED, START, START + PLAN_RETRY_MS)
		const state = outcome_cache({ ...CACHED_CLOSED, is_merged }, gather)
		const read = vi.mocked(gather.ports.read_closed)

		await gather_github(state, gather)
		expect(read).toHaveBeenCalledTimes(is_merged ? 0 : 1)
	})

	it('keeps a closed outcome without reading it again', async () => {
		const outcome = {
			summary: 'No change needed',
			url: 'https://github.com/o/r/issues/1#issuecomment-1',
		}
		const gather = lane_gather(UNTITLED, START, START + PLAN_RETRY_MS)
		const state = outcome_cache({ ...CACHED_CLOSED, outcome }, gather)

		await gather_github(state, gather)
		expect(gather.ports.read_closed).not.toHaveBeenCalled()
	})
})

describe('run_board_github.gather_github with an untitled lane', () => {
	it('reads the plan inside the retry interval for a lane started after the last read', async () => {
		const state = await gather_github(READ_STATE, lane_gather(UNTITLED, START + 1, START + 2))

		expect(state.attempted_ms).toBe(START + 2)
	})

	it('waits the interval once a read after the lane still has no title for it', async () => {
		const reread = await gather_github(READ_STATE, lane_gather(UNTITLED, START + 1, START + 2))
		const next = await gather_github(reread, lane_gather(UNTITLED, START + 1, START + 3))

		expect(next.attempted_ms).toBe(START + 2)
	})

	it('waits the interval for a lane started before the last read', async () => {
		const state = await gather_github(READ_STATE, lane_gather(UNTITLED, START - 1, START + 2))

		expect(state.attempted_ms).toBe(START)
	})

	it('waits the interval for a lane the plan has a title for', async () => {
		const state = await gather_github(READ_STATE, lane_gather(TITLED, START + 1, START + 2))

		expect(state.attempted_ms).toBe(START)
	})

	it('launches no second read while one is in flight', async () => {
		const gather = lane_gather(UNTITLED, START + 1, START + 2)
		const ports = { ...gather.ports, read_plan: never }
		const background: Gather = { ...gather, pace: 'background', ports }
		const first = await gather_github(READ_STATE, background)
		const later = lane_gather(UNTITLED, START + 3, START + 4)
		const second = await gather_github(first, { ...later, pace: 'background', ports })

		expect(second.plan_fetch).toBe(first.plan_fetch)
		expect(second.attempted_ms).toBe(START + 2)
	})

	it('holds an ended run’s plan', async () => {
		const gather = lane_gather(UNTITLED, START + 1, START + 2)
		const local = { ...gather.local, ended_ms: START + 2 }
		const state = await gather_github(READ_STATE, { ...gather, local })

		expect(state.attempted_ms).toBe(START)
	})
})

// joshuafolkken/kit#3969, #4269: a lane an earlier run left behind was drawn 🛑 as this run's child.
// Whose lane it is is now its record's, whatever this run's span says of its issue.
const LEFTOVER = 3936
const RESUMED = 3961
const RESUMED_STATUS: ItemStatus = { state: 'running', lane: `lane ${String(RESUMED)}` }
const LANE_STATES: BoardLanes = {
	own: new Map([[RESUMED, RESUMED_STATUS]]),
	earlier: new Map([[LEFTOVER, { state: 'running' }]]),
	unknown: [],
}

function statuses_with(events: ReadonlyArray<RunEvent>): ReadonlyMap<number, ItemStatus> {
	const lanes = [String(LEFTOVER), String(RESUMED)]
	const local: LocalRead = { ...LOCAL, events, lanes, lane_states: LANE_STATES }

	return run_board_github.statuses_for(FRESH_STATE, local)
}

describe('run_board_github.statuses_for with a lane an earlier run left', () => {
	it('leaves the earlier run’s lane out, even where the span holds its launch', () => {
		const launch = {
			pos: 1,
			at: new Date(START).toISOString(),
			kind: 'child-launch',
			text: '#3936 a',
		}

		expect(statuses_with([launch]).has(LEFTOVER)).toBe(false)
	})

	it('draws this run’s lane as its record says though the stream never saw it launched', () => {
		expect(statuses_with([]).get(RESUMED)).toStrictEqual(RESUMED_STATUS)
	})
})

// joshuafolkken/kit#6559: GitHub's core rate limit is read beside the plan, as often as the plan, and a
// failed read clears the allowance rather than keeping a stale one on the usage row.
const CORE: GithubRateLimit = {
	core: { remaining: 4321, limit: 5000, reset_ms: START + 1 },
	graphql: undefined,
}

function rate_gather(
	read_rate_limit: () => Promise<GithubRateLimit | undefined>,
	pace: Pace,
	now_ms = START,
): Gather {
	const gather = gather_of([plan_titled('a'), plan_titled('a')], pace)

	return { ...gather, ports: { ...gather.ports, read_rate_limit }, now_ms }
}

describe('run_board_github.gather_github rate limit', () => {
	it('waits for the rate limit and folds it in at the settled pace', async () => {
		const state = await gather_github(
			FRESH_STATE,
			rate_gather(async () => CORE, 'settled'),
		)

		expect(state.rate_limit).toStrictEqual(CORE)
		expect(state.rate_limit_fetch).toBeUndefined()
	})

	it('waits at the settled pace for a rate limit that lands after the plan', async () => {
		async function later(): Promise<GithubRateLimit> {
			return await new Promise((resolve) => {
				setTimeout(() => {
					resolve(CORE)
				}, 0)
			})
		}

		const state = await gather_github(FRESH_STATE, rate_gather(later, 'settled'))

		expect(state.rate_limit).toStrictEqual(CORE)
	})

	it('launches the read and returns without it in the background', async () => {
		const state = await gather_github(FRESH_STATE, rate_gather(never, 'background'))

		expect(state.rate_limit).toBeUndefined()
		expect(state.rate_limit_fetch?.answer()).toBeUndefined()
		expect(state.rate_limit_attempted_ms).toBe(START)
	})
})

describe('run_board_github.gather_github rate limit throttle', () => {
	it('does not launch a second read while one is in flight', async () => {
		const read = vi.fn(never)
		const first = await gather_github(FRESH_STATE, rate_gather(read, 'background'))
		const second = await gather_github(
			first,
			rate_gather(read, 'background', START + PLAN_RETRY_MS),
		)

		expect(second.rate_limit_fetch).toBe(first.rate_limit_fetch)
		expect(read).toHaveBeenCalledTimes(1)
	})

	it('reads again only after the plan interval, clearing the allowance when that read fails', async () => {
		const read = vi
			.fn<() => Promise<GithubRateLimit | undefined>>()
			.mockResolvedValueOnce(CORE)
			.mockRejectedValueOnce(new Error('offline'))
		const first = await gather_github(FRESH_STATE, rate_gather(read, 'settled'))
		const early = START + PLAN_RETRY_MS - 1
		const second = await gather_github(first, rate_gather(read, 'settled', early))
		const third = await gather_github(second, rate_gather(read, 'settled', early + 1))

		expect(second.rate_limit).toStrictEqual(CORE)
		expect(third.rate_limit).toBeUndefined()
		expect(read).toHaveBeenCalledTimes(2)
	})
})
