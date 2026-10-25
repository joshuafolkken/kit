import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#4916: `run:merge` withdraws the open lane of a child it booked withdrawn unless a
// withdrawal is already on the stream, through the `run:wake` sweep's guarded path.

const events_mock = vi.hoisted(() => vi.fn())
const find_lane_mock = vi.hoisted(() => vi.fn())
const withdraw_lane_mock = vi.hoisted(() => vi.fn())
const COLLECTED = vi.hoisted(() => ({ note: 'withdrawn note', is_retry: false }))

vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { current_events: events_mock },
}))
vi.mock('#scripts/lane/lane-registry', () => ({
	lane_registry: { find_open_lane: find_lane_mock },
}))
vi.mock('#scripts/lane/lane-withdraw-closed', () => ({
	lane_withdraw_closed: { withdraw_lane: withdraw_lane_mock },
}))

const { run_merge_withdrawn } = await import('./run-merge-withdrawn')

const CHILD = '4906'
const LANE = { issue: CHILD, branch: `${CHILD}-lane` }
const NOTHING = { note: undefined, is_retry: false }
const WITHDRAW_EVENT = {
	pos: 1,
	at: '2026-10-25T00:00:00.000Z',
	kind: 'withdraw',
	text: `#${CHILD} withdrawn by a person: x`,
}

beforeEach(() => {
	events_mock.mockReset().mockResolvedValue([])
	find_lane_mock.mockReset().mockResolvedValue(LANE)
	withdraw_lane_mock.mockReset().mockResolvedValue(COLLECTED)
})

describe('run_merge_withdrawn.collect', () => {
	it('withdraws the open lane of a child no one withdrew, as run:merge', async () => {
		expect(await run_merge_withdrawn.collect(CHILD)).toStrictEqual(COLLECTED)
		expect(withdraw_lane_mock).toHaveBeenCalledWith(
			LANE,
			run_merge_withdrawn.UNMERGED_REASON,
			'merge',
		)
	})

	it('leaves a child a person already withdrew alone', async () => {
		events_mock.mockResolvedValue([WITHDRAW_EVENT])

		expect(await run_merge_withdrawn.collect(CHILD)).toStrictEqual(NOTHING)
		expect(withdraw_lane_mock).not.toHaveBeenCalled()
	})

	it('has nothing to withdraw where no lane is open', async () => {
		find_lane_mock.mockResolvedValue(undefined)

		expect(await run_merge_withdrawn.collect(CHILD)).toStrictEqual(NOTHING)
		expect(withdraw_lane_mock).not.toHaveBeenCalled()
	})
})
