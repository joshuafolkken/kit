import type { LaneInfo } from '#scripts/lane/lane-registry'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const limit_mock = vi.hoisted(() => vi.fn())
const lane_use_mock = vi.hoisted(() => vi.fn())
const list_lanes_mock = vi.hoisted(() => vi.fn())
const place_waiting_mock = vi.hoisted(() => vi.fn())
const mark_mock = vi.hoisted(() => vi.fn())
const REPOSITORY = vi.hoisted(() => '/repo/.git')

vi.mock('#scripts/lane/lane-capacity', () => ({
	lane_capacity: { lane_limit: limit_mock, seated_limit: (limit: number): number => limit },
}))
vi.mock('#scripts/backlog/backlog-ready', () => ({ backlog_ready: { lane_use: lane_use_mock } }))
vi.mock('#scripts/lane/lane-registry', () => ({
	lane_registry: { list_lanes: list_lanes_mock },
}))
vi.mock('#scripts/lane/lane-handoff', () => ({
	lane_handoff: { is_place_waiting: place_waiting_mock },
}))
vi.mock('#scripts/git/git-common-directory', () => ({
	git_common_directory: { repository: (): string => REPOSITORY },
}))
vi.mock('node:timers/promises', () => ({ setTimeout: async (): Promise<void> => undefined }))

const { run_ship_place } = await import('./run-ship-place')
const { run_ship_stage } = await import('./run-ship-stage')

const LIMIT = 2
const USE = { occupied: 1, seated: 1, unknown: [] }
const PLACE_POLLS = 120

function lane_of(issue: string): LaneInfo {
	return {
		issue,
		branch: `${issue}-lane`,
		directory: `/lanes/${issue}`,
		seat: undefined,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded: false,
	}
}

const LANE = lane_of('20')
const WAITERS = [lane_of('9'), LANE, lane_of('30')]

beforeEach(() => {
	limit_mock.mockReset().mockResolvedValue({ kind: 'limit', limit: LIMIT })
	lane_use_mock.mockReset().mockResolvedValue(USE)
	list_lanes_mock.mockReset().mockResolvedValue([LANE])
	place_waiting_mock.mockReset().mockReturnValue(false)
	vi.spyOn(run_ship_stage, 'mark_place_waiting').mockImplementation(mark_mock)
	mark_mock.mockReset()
})

// joshuafolkken/kit#4466: the freed place may have gone to the next launch, so a followup stop waits for a
// place before it relaunches.
describe('run_ship_place.await_place on a followup stop', () => {
	it('waits while the lanes are past the limit, then returns', async () => {
		lane_use_mock
			.mockResolvedValueOnce({ ...USE, occupied: LIMIT + 1 })
			.mockResolvedValueOnce({ ...USE, occupied: LIMIT + 1 })
			.mockResolvedValue({ ...USE, occupied: LIMIT })
		await run_ship_place.await_place(LANE, 'followup')

		expect(lane_use_mock).toHaveBeenCalledTimes(3)
	})

	it('returns once the wait runs out with the lanes still full', async () => {
		lane_use_mock.mockResolvedValue({ ...USE, occupied: LIMIT + 1 })
		await run_ship_place.await_place(LANE, 'followup')

		expect(lane_use_mock).toHaveBeenCalledTimes(PLACE_POLLS)
	})

	it('waits on nothing when the lane limit cannot be read', async () => {
		limit_mock.mockResolvedValue({ kind: 'invalid', problem: 'JOSH_LANE_LIMIT is not a number' })
		await run_ship_place.await_place(LANE, 'followup')

		expect(lane_use_mock).not.toHaveBeenCalled()
	})

	it('waits on no lane count for a stop before the followup', async () => {
		await run_ship_place.await_place(LANE, 'gate')

		expect(lane_use_mock).not.toHaveBeenCalled()
		expect(mark_mock).not.toHaveBeenCalled()
	})

	it('marks its wait on the ship stage record and clears it when the wait ends', async () => {
		await run_ship_place.await_place(LANE, 'followup')

		expect(mark_mock).toHaveBeenCalledTimes(2)
		expect(mark_mock).toHaveBeenNthCalledWith(1, expect.stringContaining(LANE.issue), true)
		expect(mark_mock).toHaveBeenNthCalledWith(2, expect.stringContaining(LANE.issue), false)
	})
})

// joshuafolkken/kit#4466 round 2: every waiter counts itself, so three waiters past a limit of two each saw
// the lanes full and waited out the hour together.
describe('run_ship_place.await_place with other followup stops waiting', () => {
	beforeEach(() => {
		list_lanes_mock.mockResolvedValue(WAITERS)
		place_waiting_mock.mockReturnValue(true)
		lane_use_mock.mockResolvedValue({ ...USE, occupied: WAITERS.length })
	})

	it.each([
		['first', '9'],
		['second', '20'],
	])('the %s waiter in issue order relaunches at once', async (_order, issue) => {
		await run_ship_place.await_place(lane_of(issue), 'followup')

		expect(lane_use_mock).toHaveBeenCalledTimes(1)
	})

	it('the waiter past the limit waits on the ones ahead of it', async () => {
		await run_ship_place.await_place(lane_of('30'), 'followup')

		expect(lane_use_mock).toHaveBeenCalledTimes(PLACE_POLLS)
	})

	it('counts a lane whose ship does not wait for a place', async () => {
		place_waiting_mock.mockImplementation((issue: string) => issue !== '30')
		await run_ship_place.await_place(lane_of('20'), 'followup')

		expect(lane_use_mock).toHaveBeenCalledTimes(PLACE_POLLS)
	})
})
