import { beforeEach, describe, expect, it, vi } from 'vitest'

const build_mock = vi.hoisted(() => vi.fn())
const ISSUE = vi.hoisted(() => '4780')

vi.mock('./run-ship-stop-context', () => ({
	run_ship_stop_context: {
		build: build_mock,
		describe: (): string => '',
		has_excerpt: (): boolean => false,
	},
}))
vi.mock('./run-ship-waiter', () => ({
	run_ship_waiter: { offer: async (): Promise<boolean> => false },
}))
vi.mock('./run-ship-place', () => ({ run_ship_place: { await_place: vi.fn() } }))
vi.mock('./run-ship-relaunch-cap', () => ({
	run_ship_relaunch_cap: {
		is_over: async (): Promise<boolean> => false,
		park: async (): Promise<boolean> => true,
	},
}))
vi.mock('./run-ship-probe', () => ({
	run_ship_probe: {
		read_review_stale: async (): Promise<boolean> => false,
		repository_directory: async (): Promise<string> => '/repository',
	},
}))
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit: async (): Promise<void> => undefined },
}))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: (): boolean => true },
}))
vi.mock('#scripts/lane/lane-registry', () => ({
	lane_registry: { find_open_lane: async (): Promise<object> => ({ issue: ISSUE }) },
}))
vi.mock('#scripts/lane/lane-relaunch', () => ({
	lane_relaunch: { relaunch: async (): Promise<object> => ({ kind: 'launched', pid: 1 }) },
}))
vi.mock('#scripts/lane/lane-session-broker', () => ({
	lane_session_broker: { serving_session: (): undefined => undefined, request: vi.fn() },
}))
vi.mock('node:timers/promises', () => ({ setTimeout: async (): Promise<void> => undefined }))

const { run_ship_return } = await import('./run-ship-return')

// joshuafolkken/kit#4780: a review stop hands its findings to the stop context, which looks up the lane's
// earlier findings on the files they cite.

const RESUME = { title: `Carry earlier findings #${ISSUE}`, flags: [], is_review: true }

beforeEach(() => {
	build_mock.mockReset().mockResolvedValue({ excerpt: [], more_changed: 0 })
	vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

describe('run_ship_return.return_control — the findings of a review stop', () => {
	it('hands each deciding finding to the stop context', async () => {
		const body = 'bug-risks:medium:a.ts:3 — stale. More.\nreview found High/Medium'

		await run_ship_return.return_control(ISSUE, 'review', RESUME, body)

		expect(build_mock).toHaveBeenCalledWith(ISSUE, body, [
			{ kind: 'bug-risks:medium', location: 'a.ts:3', sentence: 'stale.' },
		])
	})

	it('hands no finding for a stop that is not a review', async () => {
		await run_ship_return.return_control(ISSUE, 'gate', RESUME, 'FAIL gate')

		expect(build_mock).toHaveBeenCalledWith(ISSUE, 'FAIL gate', [])
	})
})
