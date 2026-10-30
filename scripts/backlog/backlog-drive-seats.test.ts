import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_vacant } from '#scripts/lane/lane-vacant'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive_seats } from './backlog-drive-seats'

const KEPT = '3869'

const KEPT_TOO = '3871'

function ports(free: number, room = free): Parameters<typeof backlog_drive_seats.seated>[1] {
	return {
		free_lanes: async () => free,
		limit_room: async () => room,
		has_lane: async (issue) => issue === KEPT || issue === KEPT_TOO,
	}
}

// joshuafolkken/kit#4107: a lane with no child in it holds no place under the limit, so resuming its
// issue takes a place under it — ahead of a fresh launch, and never past the limit. It keeps its port
// seat, so seats filled by idle kept lanes do not shut out their resumes.
describe('backlog_drive_seats.seated', () => {
	it('requires a free port seat for a kept lane as well as a fresh launch', async () => {
		expect(await backlog_drive_seats.seated(['3870', KEPT, KEPT_TOO], ports(0, 1))).toStrictEqual(
			[],
		)
	})

	it('seats fresh launches only in what the resumes leave of the limit room', async () => {
		expect(await backlog_drive_seats.seated([KEPT, '3870', '3874'], ports(2, 2))).toStrictEqual([
			KEPT,
			'3870',
		])
	})

	it('seats an issue holding a kept lane first, inside the free lanes', async () => {
		expect(await backlog_drive_seats.seated(['3870', KEPT, '3874'], ports(1))).toStrictEqual([KEPT])
	})

	it('seats the rest after the kept-lane issue up to the free lanes', async () => {
		expect(await backlog_drive_seats.seated(['3870', KEPT, '3874'], ports(2))).toStrictEqual([
			KEPT,
			'3870',
		])
	})

	it('seats no issue, a kept-lane one included, when no lane is free', async () => {
		expect(await backlog_drive_seats.seated(['3870', KEPT], ports(0))).toStrictEqual([])
	})
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
