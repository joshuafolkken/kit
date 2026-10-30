import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { detached_launch } from '#scripts/run/detached-launch'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { LaneInfo } from './lane-registry'
import { lane_relaunch } from './lane-relaunch'
import { lane_seat_start } from './lane-seat-start'

const ISSUE = '5444'
const NEW_SEAT = 2
const LANE: LaneInfo = {
	issue: ISSUE,
	branch: `${ISSUE}-lane`,
	directory: '/lanes/5444',
	seat: 1,
	development_port: undefined,
	preview_port: undefined,
	output: undefined,
	is_stranded: false,
}

beforeEach(() => {
	vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
	vi.spyOn(detached_launch, 'launch').mockReturnValue({ kind: 'launched', pid: 1 })
	vi.spyOn(lane_seat_start, 'start').mockImplementation(
		async (saved, action) => await action({ ...saved, seat: NEW_SEAT }),
	)
	vi.spyOn(lane_seat_start, 'environment').mockImplementation((seated) => ({
		JOSH_LANE_SEAT: String(seated.seat),
	}))
})

afterEach(() => {
	vi.restoreAllMocks()
})

it('reacquires a seat for the cut and ship fallback before launching with the new seat', async () => {
	await expect(lane_relaunch.resume(LANE, 'pre-gate', vi.fn())).resolves.toMatchObject({
		kind: 'launched',
	})
	expect(lane_seat_start.start).toHaveBeenCalledWith(LANE, expect.any(Function))
	const request = vi.mocked(detached_launch.launch).mock.calls[0]?.[0]

	expect(request?.cwd).toBe(LANE.directory)
	expect(request?.env).toMatchObject({ JOSH_LANE_SEAT: String(NEW_SEAT) })
})

it('returns an allocation refusal through the existing relaunch failure protocol', async () => {
	const note = 'port ownership is unreadable'

	vi.mocked(lane_seat_start.start).mockRejectedValue(new Error(note))

	await expect(lane_relaunch.resume(LANE, 'pre-gate', vi.fn())).resolves.toEqual({
		kind: 'failed',
		note,
	})
	expect(detached_launch.launch).not.toHaveBeenCalled()
})
