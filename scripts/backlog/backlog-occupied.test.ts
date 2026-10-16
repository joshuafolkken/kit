import type { LaneInfo } from '#scripts/lane/lane-registry'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
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

// Every lane idle unless `extra.idle` says otherwise.
function read_of(invocation: string | undefined, extra: Partial<OccupiedRead> = {}): OccupiedRead {
	return {
		invocation,
		events: [],
		idle: (lanes) => lanes.map((one) => one.issue),
		...extra,
	}
}

function occupied(lanes: ReadonlyArray<LaneInfo>, read: OccupiedRead): Array<string> {
	return backlog_occupied.occupied_lanes(lanes, read).map((one) => one.issue)
}

const LANES = [lane(NAMED), ...LEFT_BEHIND.map((issue) => lane(issue))]

describe('backlog_occupied.occupied_lanes under a --only run', () => {
	it('drops the idle lanes the run does not own, so the named issues find a lane', () => {
		expect(occupied(LANES, read_of(ONLY_RUN))).toStrictEqual([NAMED])
	})

	it('keeps a lane the run does not own while its child still works', () => {
		const working = read_of(ONLY_RUN, { idle: () => [NAMED, '3943', '3948', '3956'] })

		expect(occupied(LANES, working)).toStrictEqual([NAMED, '3958'])
	})

	it('keeps an idle lane this run launched into, though the invocation does not name it', () => {
		const child_of_epic = read_of(ONLY_RUN, { events: [launched('3943')] })

		expect(occupied(LANES, child_of_epic)).toStrictEqual([NAMED, '3943'])
	})

	it('counts every open lane where the run’s events could not be scoped', () => {
		const unscoped = read_of(ONLY_RUN, { events: undefined })

		expect(occupied(LANES, unscoped)).toStrictEqual([NAMED, ...LEFT_BEHIND])
	})

	it('never counts a stranded lane', () => {
		expect(occupied([lane(NAMED, true)], read_of(ONLY_RUN))).toStrictEqual([])
	})
})

describe('backlog_occupied.occupied_lanes outside a --only run', () => {
	it('counts every open lane for a run that drains the pool', () => {
		expect(occupied(LANES, read_of(POOL_RUN))).toStrictEqual([NAMED, ...LEFT_BEHIND])
	})

	it('counts every open lane when no run is live', () => {
		expect(occupied(LANES, read_of(undefined))).toStrictEqual([NAMED, ...LEFT_BEHIND])
	})

	it('reads no child for a run that drains the pool', () => {
		const unread = read_of(POOL_RUN, {
			idle: () => {
				throw new Error('idle read')
			},
		})

		expect(occupied(LANES, unread)).toHaveLength(LANES.length)
	})
})
