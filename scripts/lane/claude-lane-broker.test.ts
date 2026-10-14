import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { claude_lane_broker } from './claude-lane-broker'
import type { LaneInfo } from './lane-registry'
import { lane_session_broker } from './lane-session-broker'

// joshuafolkken/kit#3817: the supervisor serves the broker for every open Claude lane, and only for as long as
// the lane stays open.

const CLAUDE = '3817'
const OPENAI = '3818'
const STRANDED = '3819'
const BASE: LaneInfo = {
	issue: CLAUDE,
	directory: '/lanes/3817',
	branch: '3817-lane',
	seat: undefined,
	development_port: undefined,
	preview_port: undefined,
	output: undefined,
	is_stranded: false,
}
const OPENAI_LANE: LaneInfo = {
	...BASE,
	issue: OPENAI,
	profile: { provider: 'openai', role: 'worker', model: 'gpt-6.1-sol', effort: 'high' },
}
const STRANDED_LANE: LaneInfo = { ...BASE, issue: STRANDED, is_stranded: true }

const state = { closed: [] as Array<string> }

beforeEach(() => {
	vi.useFakeTimers()
	state.closed = []
	vi.spyOn(lane_session_broker, 'with_server').mockImplementation(async (lane, run) => {
		await run()
		state.closed.push(lane.issue)
	})
})

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

function served(): ReadonlyArray<string> {
	return vi.mocked(lane_session_broker.with_server).mock.calls.map(([lane]) => lane.issue)
}

it('serves an open Claude lane and skips OpenAI and stranded lanes', async () => {
	const stop = claude_lane_broker.start(async () => [BASE, OPENAI_LANE, STRANDED_LANE])

	await stop()

	expect(served()).toStrictEqual([CLAUDE])
	expect(state.closed).toStrictEqual([CLAUDE])
})

it('stops serving a lane once it is no longer listed', async () => {
	const list = vi
		.fn<() => Promise<ReadonlyArray<LaneInfo>>>()
		.mockResolvedValueOnce([BASE])
		.mockResolvedValue([])
	const stop = claude_lane_broker.start(list)

	await vi.advanceTimersByTimeAsync(claude_lane_broker.SCAN_INTERVAL_MS)

	expect(state.closed).toStrictEqual([CLAUDE])
	await stop()
	expect(served()).toStrictEqual([CLAUDE])
})

it('serves a lane opened after the broker started', async () => {
	const list = vi
		.fn<() => Promise<ReadonlyArray<LaneInfo>>>()
		.mockResolvedValueOnce([])
		.mockResolvedValue([BASE])
	const stop = claude_lane_broker.start(list)

	await vi.advanceTimersByTimeAsync(claude_lane_broker.SCAN_INTERVAL_MS)
	await stop()

	expect(served()).toStrictEqual([CLAUDE])
})

// A closed lane re-listed while its old server still answers a reviewer is reopened only once that
// server has finished, so two servers never write one lane's response.
it('reopens a re-listed lane only after its old server has finished', async () => {
	const release = { finish: (): void => undefined }

	vi.mocked(lane_session_broker.with_server).mockImplementationOnce(async (lane, run) => {
		await run()
		await new Promise<void>((resolve) => {
			release.finish = resolve
		})
		state.closed.push(lane.issue)
	})
	const list = vi
		.fn<() => Promise<ReadonlyArray<LaneInfo>>>()
		.mockResolvedValueOnce([BASE])
		.mockResolvedValueOnce([])
		.mockResolvedValue([BASE])
	const stop = claude_lane_broker.start(list)

	await vi.advanceTimersByTimeAsync(claude_lane_broker.SCAN_INTERVAL_MS * 2)
	expect(served()).toStrictEqual([CLAUDE])

	release.finish()
	await vi.advanceTimersByTimeAsync(claude_lane_broker.SCAN_INTERVAL_MS)
	await stop()

	expect(served()).toStrictEqual([CLAUDE, CLAUDE])
})

it('serves the lanes for exactly as long as the run it wraps', async () => {
	const during = { closed: [] as ReadonlyArray<string> }
	const result = await claude_lane_broker.serve_during(
		async () => {
			await vi.waitFor(() => {
				expect(served()).toStrictEqual([CLAUDE])
			})
			during.closed = [...state.closed]

			return 'stop'
		},
		async () => [BASE],
	)

	expect(result).toBe('stop')
	expect(during.closed).toStrictEqual([])
	expect(state.closed).toStrictEqual([CLAUDE])
})

it('keeps scanning when listing the lanes fails', async () => {
	const list = vi
		.fn<() => Promise<ReadonlyArray<LaneInfo>>>()
		.mockRejectedValueOnce(new Error('registry unreadable'))
		.mockResolvedValue([BASE])
	const stop = claude_lane_broker.start(list)

	await vi.advanceTimersByTimeAsync(claude_lane_broker.SCAN_INTERVAL_MS)
	await stop()

	expect(served()).toStrictEqual([CLAUDE])
})
