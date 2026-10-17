import type { LaneInfo } from '#scripts/lane/lane-registry'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it, vi } from 'vitest'
import { backlog_occupied, type OccupiedRead } from './backlog-occupied'

// joshuafolkken/kit#3967: `backlogrun #3964 #3936 #3961 --only` started beside five lanes an earlier run
// left with no child in them, so `lane:limit` read `lane limit 4 · in use 5 · free 0` and the two named
// issues with no lane of their own waited for lanes nobody would ever close.

const ONLY_RUN = 'backlogrun #3964 #3936 #3961 --only'
const POOL_RUN = 'backlogrun'
const NAMED = '3936'
const LEFT_BEHIND = ['3943', '3948', '3956', '3958']
const AT = '2026-10-16T10:31:00.000Z'

function lane(issue: string, is_stranded = false): LaneInfo {
	return {
		issue,
		branch: `${issue}-lane`,
		directory: `/lanes/${issue}`,
		seat: 1,
		development_port: undefined,
		preview_port: undefined,
		output: `/tmp/${issue}.log`,
		is_stranded,
	}
}

function launched(issue: string): RunEvent {
	return {
		pos: 1,
		at: AT,
		kind: run_event_stream.EVENT_KIND.CHILD_LAUNCH,
		text: `#${issue} dispatched`,
	}
}

// Every lane idle and none vacant unless `extra` says otherwise.
function read_of(invocation: string | undefined, extra: Partial<OccupiedRead> = {}): OccupiedRead {
	return {
		invocation,
		events: [],
		idle: (lanes) => lanes.map((one) => one.issue),
		vacant: async () => [],
		...extra,
	}
}

async function occupied(
	lanes: ReadonlyArray<LaneInfo>,
	read: OccupiedRead,
): Promise<Array<string>> {
	const held = await backlog_occupied.occupied_lanes(lanes, read)

	return held.map((one) => one.issue)
}

const LANES = [lane(NAMED), ...LEFT_BEHIND.map((issue) => lane(issue))]

describe('backlog_occupied.occupied_lanes under a --only run', () => {
	it('drops the idle lanes the run does not own, so the named issues find a lane', async () => {
		await expect(occupied(LANES, read_of(ONLY_RUN))).resolves.toStrictEqual([NAMED])
	})

	it('keeps a lane the run does not own while its child still works', async () => {
		const working = read_of(ONLY_RUN, { idle: () => [NAMED, '3943', '3948', '3956'] })

		await expect(occupied(LANES, working)).resolves.toStrictEqual([NAMED, '3958'])
	})

	it('keeps an idle lane this run launched into, though the invocation does not name it', async () => {
		const child_of_epic = read_of(ONLY_RUN, { events: [launched('3943')] })

		await expect(occupied(LANES, child_of_epic)).resolves.toStrictEqual([NAMED, '3943'])
	})

	it('counts every open lane where the run’s events could not be scoped', async () => {
		const unscoped = read_of(ONLY_RUN, { events: undefined })

		await expect(occupied(LANES, unscoped)).resolves.toStrictEqual([NAMED, ...LEFT_BEHIND])
	})

	it('never counts a stranded lane', async () => {
		await expect(occupied([lane(NAMED, true)], read_of(ONLY_RUN))).resolves.toStrictEqual([])
	})
})

describe('backlog_occupied.occupied_lanes outside a --only run', () => {
	it('counts every open lane for a run that drains the pool', async () => {
		await expect(occupied(LANES, read_of(POOL_RUN))).resolves.toStrictEqual([NAMED, ...LEFT_BEHIND])
	})

	it('counts every open lane when no run is live', async () => {
		await expect(occupied(LANES, read_of(undefined))).resolves.toStrictEqual([
			NAMED,
			...LEFT_BEHIND,
		])
	})

	it('reads no child for a run that drains the pool', async () => {
		const unread = read_of(POOL_RUN, {
			idle: () => {
				throw new Error('idle read')
			},
		})

		await expect(occupied(LANES, unread)).resolves.toHaveLength(LANES.length)
	})
})

// joshuafolkken/kit#4028: a drain run's limit of four held #4023 running, #3988 parked and #4002 /
// #4005 ended before their start time — the last three with no commit, no change and no child.
const RUNNING = '4023'
const VACANT = ['3988', '4002', '4005']
const DRAIN_LANES = [RUNNING, ...VACANT].map((issue) => lane(issue))

describe('backlog_occupied.occupied_lanes — a vacant lane holds no place', () => {
	it.each([
		['a run that drains the pool', POOL_RUN],
		['a --only run', ONLY_RUN],
		['no live run', undefined],
	])('drops the vacant lanes under %s', async (_run, invocation) => {
		const read = read_of(invocation, { idle: () => VACANT, vacant: async () => VACANT })

		await expect(occupied(DRAIN_LANES, read)).resolves.toStrictEqual([RUNNING])
	})

	it('counts a stopped lane that holds a commit or a change', async () => {
		const read = read_of(POOL_RUN, { idle: () => VACANT, vacant: async () => ['4002', '4005'] })

		await expect(occupied(DRAIN_LANES, read)).resolves.toStrictEqual([RUNNING, '3988'])
	})

	it('asks vacancy of no stranded lane', async () => {
		const vacant = vi.fn(async () => [])

		await occupied([lane(NAMED, true), lane(RUNNING)], read_of(POOL_RUN, { vacant }))

		expect(vacant).toHaveBeenCalledWith([lane(RUNNING)])
	})
})
