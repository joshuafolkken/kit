import { beforeEach, describe, expect, it, vi } from 'vitest'

const offer_mock = vi.hoisted(() => vi.fn())
const relaunch_mock = vi.hoisted(() => vi.fn())
const request_mock = vi.hoisted(() => vi.fn())
const place_mock = vi.hoisted(() => vi.fn())
const is_over_mock = vi.hoisted(() => vi.fn())
const REPOSITORY = vi.hoisted(() => '/repository')
const ISSUE = vi.hoisted(() => '4711')

vi.mock('./run-ship-waiter', () => ({ run_ship_waiter: { offer: offer_mock } }))
vi.mock('./run-ship-place', () => ({ run_ship_place: { await_place: place_mock } }))
vi.mock('./run-ship-relaunch-cap', () => ({
	run_ship_relaunch_cap: { is_over: is_over_mock, park: async (): Promise<boolean> => true },
}))
vi.mock('./run-ship-probe', () => ({
	run_ship_probe: {
		read_review_stale: async (): Promise<boolean> => false,
		repository_directory: async (): Promise<string> => REPOSITORY,
	},
}))
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit: async (): Promise<void> => undefined },
}))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: (): boolean => true },
}))
vi.mock('#scripts/lane/lane-registry', () => ({
	lane_registry: {
		find_open_lane: async (): Promise<object> => ({ issue: ISSUE, directory: '/lanes/4711' }),
	},
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

// joshuafolkken/kit#4711: the session that launched the ship and still waits on it takes the stop, so no
// fresh session re-reads the run; a session that ended is relaunched as before.

const TITLE = `Return a stopped review #${ISSUE}`
const BODY_PATH = 'scratchpad/evidence.md'
const RESUME = { title: TITLE, flags: ['--body-file', BODY_PATH], is_review: true }
const OUTPUT = 'High: scripts/run/ship/run-ship-return.ts'
const STAGE = 'review'

beforeEach(() => {
	offer_mock.mockReset().mockResolvedValue(false)
	relaunch_mock.mockReset().mockReturnValue({ kind: 'launched', pid: 1 })
	request_mock.mockReset()
	place_mock.mockReset().mockResolvedValue(undefined)
	is_over_mock.mockReset().mockResolvedValue(false)
	vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

describe('run_ship_return.return_control — a waiting session', () => {
	it('hands the stop note to the waiting session and relaunches nothing', async () => {
		offer_mock.mockResolvedValue(true)

		expect(await run_ship_return.return_control(ISSUE, STAGE, RESUME, OUTPUT)).toBe('returned')

		const [repository, issue, note] = (offer_mock.mock.calls[0] ?? []) as ReadonlyArray<unknown>

		expect([repository, issue]).toStrictEqual([REPOSITORY, ISSUE])
		expect(String(note)).toContain(`--body-file ${BODY_PATH} '${TITLE}'`)
		expect(String(note)).not.toContain('Resuming the lane child')
		expect(relaunch_mock).not.toHaveBeenCalled()
		expect(request_mock).not.toHaveBeenCalled()
		expect(place_mock).not.toHaveBeenCalled()
	})

	it('relaunches a fresh session where no session took the stop', async () => {
		expect(await run_ship_return.return_control(ISSUE, STAGE, RESUME, OUTPUT)).toBe('relaunched')
		expect(offer_mock).toHaveBeenCalledOnce()
		expect(relaunch_mock).toHaveBeenCalledOnce()
	})

	it('offers nothing past the ship-stop cap', async () => {
		is_over_mock.mockResolvedValue(true)

		expect(await run_ship_return.return_control(ISSUE, STAGE, RESUME, OUTPUT)).toBe('parked')
		expect(offer_mock).not.toHaveBeenCalled()
	})
})
