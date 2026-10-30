import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_reap } from './lane-reap'
import { lane_reap_settle } from './lane-reap-settle'
import { lane_registry } from './lane-registry'
import { lane_residents } from './lane-residents'
import { lane_seat_stop } from './lane-seat-stop'

const ISSUE = '5444'
const PID = 123
const LANE = { issue: ISSUE, directory: '/lanes/5444' }

beforeEach(() => {
	vi.spyOn(lane_registry, 'lane_location').mockResolvedValue(LANE)
	vi.spyOn(lane_reap, 'reap_child').mockReturnValue([PID])
	vi.spyOn(lane_residents, 'end_residents').mockReturnValue([])
	vi.spyOn(lane_reap_settle, 'settle').mockResolvedValue([])
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('stopping a lane seat owner', () => {
	it('ends only the named lane and confirms its processes are gone', async () => {
		await lane_seat_stop.stop(ISSUE)
		expect(lane_residents.end_residents).toHaveBeenCalledWith(LANE, [PID])
		expect(lane_reap_settle.settle).toHaveBeenCalledWith(LANE)
	})

	it('reports ownership that cannot be read', async () => {
		vi.mocked(lane_reap_settle.settle).mockResolvedValue(undefined)
		await expect(lane_seat_stop.stop(ISSUE)).rejects.toThrow('lsof or ps failed')
	})

	it('reports a surviving process instead of declaring the seat returned', async () => {
		vi.mocked(lane_reap_settle.settle).mockResolvedValue([
			{ pid: PID, reason: 'owned by another account' },
		])
		await expect(lane_seat_stop.stop(ISSUE)).rejects.toThrow(String(PID))
	})
})
