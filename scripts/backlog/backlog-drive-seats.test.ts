import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_vacant } from '#scripts/lane/lane-vacant'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive_seats } from './backlog-drive-seats'

const KEPT = '3869'

function ports(free: number): Parameters<typeof backlog_drive_seats.seated>[1] {
	return { free_lanes: async () => free, has_lane: async (issue) => issue === KEPT }
}

it('seats an issue holding a kept lane first and the rest up to the free lanes', async () => {
	expect(await backlog_drive_seats.seated(['3870', KEPT, '3874'], ports(1))).toStrictEqual([
		KEPT,
		'3870',
	])
})

it('seats a kept-lane issue even when no lane is free', async () => {
	expect(await backlog_drive_seats.seated(['3870', KEPT], ports(0))).toStrictEqual([KEPT])
})

// joshuafolkken/kit#4028: a vacant lane holds no place under the limit, so an issue reusing one must
// take a free lane, or a full limit would launch one child past it.
const DISPATCHED: LaneInfo = {
	issue: KEPT,
	branch: `${KEPT}-lane`,
	directory: `/lanes/${KEPT}`,
	seat: 1,
	development_port: undefined,
	preview_port: undefined,
	output: `/lanes/${KEPT}/output.log`,
	is_stranded: false,
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('backlog_drive_seats.has_kept_lane', () => {
	it('reads a dispatched lane that holds work as kept', async () => {
		vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue(DISPATCHED)
		vi.spyOn(lane_vacant, 'is_vacant').mockResolvedValue(false)

		expect(await backlog_drive_seats.has_kept_lane(KEPT)).toBe(true)
	})

	it('reads a vacant dispatched lane as not kept, so it takes a free lane', async () => {
		vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue(DISPATCHED)
		vi.spyOn(lane_vacant, 'is_vacant').mockResolvedValue(true)

		expect(await backlog_drive_seats.has_kept_lane(KEPT)).toBe(false)
	})

	it('reads a lane no child was dispatched into as not kept', async () => {
		vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue({
			...DISPATCHED,
			output: undefined,
		})
		const vacant = vi.spyOn(lane_vacant, 'is_vacant')

		expect(await backlog_drive_seats.has_kept_lane(KEPT)).toBe(false)
		expect(vacant).not.toHaveBeenCalled()
	})
})
