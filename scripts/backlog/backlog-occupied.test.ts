import type { LaneInfo } from '#scripts/lane/lane-registry'
import type { LaneRecords, LaneState, LaneStateRecord } from '#scripts/lane/lane-state'
import { describe, expect, it, vi } from 'vitest'
import { backlog_occupied, type IdleRead } from './backlog-occupied'

// joshuafolkken/kit#4107: a drain run held #4101, #4102 and #4104 running and #4091 blocked by #4101
// with no child and an uncommitted change, so `no free lane 4/4` kept #4099 and #4103 waiting with
// three children running under a limit of four.

const WORKING = '4101'
const RUNNING = [WORKING, '4102', '4104']
const BLOCKED = '4091'
const CHANGED_AT = '2026-10-20T01:28:00.000Z'

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

function record_of(issue: string, state: LaneState): LaneStateRecord {
	return { issue, state, changed_at: CHANGED_AT, changed_by: `lane:${state}` }
}

function records_of(issues: Iterable<string>, state: LaneState = 'running'): LaneRecords {
	return new Map([...issues].map((issue) => [issue, record_of(issue, state)]))
}

function occupied(
	lanes: ReadonlyArray<LaneInfo>,
	idle: IdleRead,
	records: LaneRecords = records_of(lanes.map((one) => one.issue)),
): Array<string> {
	return backlog_occupied.occupied_lanes(lanes, idle, records).map((one) => one.issue)
}

const LANES = [...RUNNING, BLOCKED].map((issue) => lane(issue))

describe('backlog_occupied.occupied_lanes', () => {
	it('drops a lane read with no child in it, whatever it waits on', () => {
		expect(occupied(LANES, () => [BLOCKED])).toStrictEqual(RUNNING)
	})

	it('counts every lane whose child still works', () => {
		expect(occupied(LANES, () => [])).toStrictEqual([...RUNNING, BLOCKED])
	})

	// `lane_spent.idle_lanes` names only the lanes pgrep answered "no match" for, so a lane whose
	// probe could not look is never among them.
	it('counts a lane whose probe did not answer, since it is not read as idle', () => {
		expect(occupied(LANES, () => RUNNING)).toStrictEqual([BLOCKED])
	})

	it('never counts a stranded lane, and asks no child of one', () => {
		const idle = vi.fn<IdleRead>(() => [])

		expect(occupied([lane(BLOCKED, true), lane(WORKING)], idle)).toStrictEqual([WORKING])
		expect(idle).toHaveBeenCalledWith([lane(WORKING)])
	})
})

// joshuafolkken/kit#4201: #4173, #4187 and #4188 were all paused with #4195 alone running, yet
// `lane:limit` read 4/4 and #4197 waited on `next free lane (4/4)`. joshuafolkken/kit#4270: paused is
// the lane state record's answer, never the `ps` state.
describe('backlog_occupied.occupied_lanes — a paused lane', () => {
	const PAUSED = ['4173', '4187', '4188']
	const ACTIVE = '4195'
	const ALL = [...PAUSED, ACTIVE].map((issue) => lane(issue))

	it('drops a lane whose record is paused', () => {
		const records = new Map([...records_of(PAUSED, 'paused'), ...records_of([ACTIVE])])

		expect(occupied(ALL, () => [], records)).toStrictEqual([ACTIVE])
	})

	it('counts a lane whose record is running', () => {
		expect(occupied(ALL, () => [])).toStrictEqual([...PAUSED, ACTIVE])
	})

	it('counts a lane with no record, since its state is unknown', () => {
		expect(occupied(ALL, () => [], records_of([ACTIVE]))).toStrictEqual([...PAUSED, ACTIVE])
	})
})

// joshuafolkken/kit#4466: a child that handed its region to a detached ship has ended, and the ship's
// followup only polls CI and the merge, yet its lane held a place for the whole wait.
const MERGING = '4466'

function is_merge_waiting(issue: string): boolean {
	return issue === MERGING
}

describe('backlog_occupied.occupied_lanes — a lane waiting on its merge', () => {
	const ALL = [lane(WORKING), lane(MERGING)]

	it('drops a lane whose detached ship waits on its merge', () => {
		const records = records_of([WORKING, MERGING])

		expect(
			backlog_occupied
				.occupied_lanes(ALL, () => [], records, is_merge_waiting)
				.map((one) => one.issue),
		).toStrictEqual([WORKING])
	})

	it('counts every lane where no merge wait is read', () => {
		expect(occupied(ALL, () => [])).toStrictEqual([WORKING, MERGING])
	})
})

describe('backlog_occupied.unknown_lanes', () => {
	it('names the live lanes with no record, never a stranded one', () => {
		const lanes = [lane(WORKING), lane(BLOCKED), lane('4105', true)]

		expect(backlog_occupied.unknown_lanes(lanes, records_of([WORKING]))).toStrictEqual([BLOCKED])
	})
})
