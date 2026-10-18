import type { LaneInfo } from '#scripts/lane/lane-registry'
import { describe, expect, it, vi } from 'vitest'
import { backlog_occupied, type IdleRead } from './backlog-occupied'

// joshuafolkken/kit#4107: a drain run held #4101, #4102 and #4104 running and #4091 blocked by #4101
// with no child and an uncommitted change, so `no free lane 4/4` kept #4099 and #4103 waiting with
// three children running under a limit of four.

const WORKING = '4101'
const RUNNING = [WORKING, '4102', '4104']
const BLOCKED = '4091'

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

function occupied(lanes: ReadonlyArray<LaneInfo>, idle: IdleRead): Array<string> {
	return backlog_occupied.occupied_lanes(lanes, idle).map((one) => one.issue)
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
