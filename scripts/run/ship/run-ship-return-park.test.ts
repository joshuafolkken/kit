import { beforeEach, describe, expect, it, vi } from 'vitest'

const is_child_mock = vi.hoisted(() => vi.fn())
const relaunch_mock = vi.hoisted(() => vi.fn())
const request_mock = vi.hoisted(() => vi.fn())
const is_over_mock = vi.hoisted(() => vi.fn())
const park_mock = vi.hoisted(() => vi.fn())
const park_timed_out_mock = vi.hoisted(() => vi.fn())
const ISSUE = vi.hoisted(() => '3999')
const LANE = vi.hoisted(() => ({ issue: ISSUE, directory: `/lanes/${ISSUE}`, profile: undefined }))

vi.mock('./run-ship-place', () => ({ run_ship_place: { await_place: vi.fn() } }))
vi.mock('./run-ship-relaunch-cap', () => ({
	run_ship_relaunch_cap: {
		is_over: is_over_mock,
		park: park_mock,
		park_timed_out: park_timed_out_mock,
	},
}))
vi.mock('./run-ship-probe', () => ({
	run_ship_probe: {
		read_review_stale: async (): Promise<boolean> => false,
		repository_directory: async (): Promise<undefined> => undefined,
	},
}))
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit: async (): Promise<void> => undefined },
}))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: is_child_mock },
}))
vi.mock('#scripts/lane/lane-registry', () => ({
	lane_registry: { find_open_lane: async (): Promise<object> => LANE },
}))
vi.mock('#scripts/lane/lane-relaunch', () => ({ lane_relaunch: { relaunch: relaunch_mock } }))
vi.mock('#scripts/lane/lane-session-broker', () => ({
	lane_session_broker: { serving_session: (): undefined => undefined, request: request_mock },
}))
vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: { read_changed_paths: async (): Promise<Array<string>> => [] },
}))
vi.mock('node:timers/promises', () => ({ setTimeout: async (): Promise<void> => undefined }))

const { run_ship_return } = await import('./run-ship-return')
const { PR_CHECKS_TIMEOUT_MESSAGE } = await import('#scripts/gh/git-pr-checks')

const RESUME = { title: `Park a stopped ship #${ISSUE}`, flags: [], is_review: true }
const OUTPUT = 'FAIL scripts/run/ship/run-ship.test.ts'
const BLOCKED = 'BLOCKED: Checks missing'
const TIMED_OUT = `❌ Error: Timed out\n💡 Details: ${BLOCKED}`
const WAIT_TIMED_OUT = `❌ Error: ${PR_CHECKS_TIMEOUT_MESSAGE}\n💡 Details: ${BLOCKED}`

beforeEach(() => {
	is_child_mock.mockReset().mockReturnValue(true)
	relaunch_mock.mockReset().mockResolvedValue({ kind: 'launched', pid: 1 })
	request_mock.mockReset().mockResolvedValue({ is_success: true })
	is_over_mock.mockReset().mockResolvedValue(false)
	park_mock.mockReset().mockResolvedValue(true)
	park_timed_out_mock.mockReset().mockResolvedValue(true)
	vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

// joshuafolkken/kit#3999: a child that keeps stopping is parked past the cap rather than relaunched forever.
describe('run_ship_return.return_control past the ship-stop cap', () => {
	// joshuafolkken/kit#5780: with the block a timed-out merge wait logged as the park's cause.
	it('parks the issue for the stopped stage and relaunches nothing', async () => {
		is_over_mock.mockResolvedValue(true)

		expect(await run_ship_return.return_control(ISSUE, 'followup', RESUME, TIMED_OUT)).toBe(
			'parked',
		)
		expect(is_over_mock).toHaveBeenCalledWith(ISSUE, 'followup')
		expect(park_mock).toHaveBeenCalledWith(ISSUE, 'followup', BLOCKED)
		expect(relaunch_mock).not.toHaveBeenCalled()
		expect(request_mock).not.toHaveBeenCalled()
	})

	it('records the stop when the park label was refused', async () => {
		is_over_mock.mockResolvedValue(true)
		park_mock.mockResolvedValue(false)

		expect(await run_ship_return.return_control(ISSUE, 'gate', RESUME, OUTPUT)).toBe('recorded')
		expect(relaunch_mock).not.toHaveBeenCalled()
	})

	it('asks the cap only inside a dispatched lane child', async () => {
		is_child_mock.mockReturnValue(false)
		await run_ship_return.return_control(ISSUE, 'gate', RESUME, OUTPUT)

		expect(is_over_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#5775: a relaunch waits the same timeout on the same blocked merge, so a merge wait
// that timed out spent every relaunch of the cap before it parked.
describe('run_ship_return.return_control on a merge wait that timed out', () => {
	it('parks the issue at once, under the cap, and relaunches nothing', async () => {
		expect(await run_ship_return.return_control(ISSUE, 'followup', RESUME, WAIT_TIMED_OUT)).toBe(
			'parked',
		)
		expect(park_timed_out_mock).toHaveBeenCalledWith(ISSUE, 'followup', BLOCKED)
		expect(park_mock).not.toHaveBeenCalled()
		expect(relaunch_mock).not.toHaveBeenCalled()
		expect(request_mock).not.toHaveBeenCalled()
	})

	it('records the timed-out stop when its park label was refused', async () => {
		park_timed_out_mock.mockResolvedValue(false)
		const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

		expect(await run_ship_return.return_control(ISSUE, 'followup', RESUME, WAIT_TIMED_OUT)).toBe(
			'recorded',
		)
		expect(write).toHaveBeenCalledWith(
			'the lane child was not relaunched, and the park label was refused\n',
		)
		expect(relaunch_mock).not.toHaveBeenCalled()
	})
})
