import { beforeEach, describe, expect, it, vi } from 'vitest'

const serving_mock = vi.hoisted(() => vi.fn())
const request_mock = vi.hoisted(() => vi.fn())
const relaunch_mock = vi.hoisted(() => vi.fn())
const LANE = vi.hoisted(() => ({ issue: '4733', directory: '/lanes/4733', profile: undefined }))

vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit: vi.fn() },
}))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: () => true },
}))
vi.mock('#scripts/lane/lane-registry', () => ({
	lane_registry: { find_open_lane: async (): Promise<unknown> => LANE },
}))
vi.mock('#scripts/lane/lane-relaunch', () => ({ lane_relaunch: { relaunch: relaunch_mock } }))
vi.mock('#scripts/lane/lane-session-broker', () => ({
	lane_session_broker: {
		serving_session: serving_mock,
		request: request_mock,
		is_unreadable: (answer: { reason?: string }): boolean =>
			answer.reason?.includes('could not read the request') === true,
	},
}))
vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: { read_changed_paths: async (): Promise<Array<string>> => ['scripts/changed.ts'] },
}))
vi.mock('node:timers/promises', () => ({ setTimeout: async (): Promise<void> => undefined }))
vi.mock('./run-ship-place', () => ({ run_ship_place: { await_place: async () => undefined } }))
vi.mock('./run-ship-relaunch-cap', () => ({
	run_ship_relaunch_cap: { is_over: async () => false },
}))

const { run_ship_return } = await import('./run-ship-return')

// joshuafolkken/kit#4733: a broker started before a stop field reached main refused the relaunch unread,
// and the ship gave up before the broker's supervisor reloaded onto the current code.

const ISSUE = LANE.issue
const RESUME = { title: `Relaunch through a reloaded broker #${ISSUE}`, flags: [], is_review: true }
const OUTPUT = 'FAIL scripts/run/ship/run-ship.test.ts'
const SERVER = 'server-1'
const NEW_SERVER = 'server-2'
const UNREADABLE = {
	is_success: false,
	reason: 'the broker could not read the request — unrecognized key: action.stop.unpinned_ok',
}
// Past a driver window and the pause between passes, inside the wait for the supervisor's reload.
const RELOAD_POLLS = 400
// The lane read before the ask, then the minute a broker that failed for a reason other than its code is
// waited for.
const SERVING_READS = 61
const STOPPED = { is_success: false, reason: 'the broker stopped serving before it answered' }
const MISMATCH = '(a version mismatch)'

beforeEach(() => {
	serving_mock.mockReset().mockReturnValue(SERVER)
	request_mock.mockReset().mockResolvedValue(UNREADABLE)
	relaunch_mock.mockReset()
	vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

describe('run_ship_return.return_control when the broker runs older code than the ship', () => {
	it('relaunches through the broker that replaced it on the current code', async () => {
		for (let poll = 0; poll <= RELOAD_POLLS; poll += 1) serving_mock.mockReturnValueOnce(SERVER)
		serving_mock.mockReturnValue(NEW_SERVER)
		request_mock.mockResolvedValueOnce(UNREADABLE).mockResolvedValue({ is_success: true })

		expect(await run_ship_return.return_control(ISSUE, 'review', RESUME, OUTPUT)).toBe('relaunched')
		expect(request_mock).toHaveBeenCalledTimes(2)
		expect(relaunch_mock).not.toHaveBeenCalled()
	})

	it('names the version mismatch when no broker on the current code serves the lane', async () => {
		const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

		expect(await run_ship_return.return_control(ISSUE, 'review', RESUME, OUTPUT)).toBe('redispatch')
		expect(request_mock).toHaveBeenCalledTimes(1)
		expect(write).toHaveBeenCalledWith(expect.stringContaining(MISMATCH))
	})

	it('waits only the minute for a broker that failed for a reason other than its code', async () => {
		serving_mock.mockReturnValueOnce(SERVER).mockReturnValue(undefined)
		request_mock.mockResolvedValue(STOPPED)

		expect(await run_ship_return.return_control(ISSUE, 'review', RESUME, OUTPUT)).toBe('redispatch')
		expect(serving_mock).toHaveBeenCalledTimes(SERVING_READS)
	})

	it('names no version mismatch when the broker that replaced it failed for another reason', async () => {
		const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

		serving_mock.mockReturnValueOnce(SERVER).mockReturnValue(NEW_SERVER)
		request_mock
			.mockResolvedValueOnce(UNREADABLE)
			.mockResolvedValue({ is_success: false, reason: 'the relaunch did not start' })

		expect(await run_ship_return.return_control(ISSUE, 'review', RESUME, OUTPUT)).toBe('redispatch')
		expect(request_mock).toHaveBeenCalledTimes(2)
		expect(write).not.toHaveBeenCalledWith(expect.stringContaining(MISMATCH))
	})
})
