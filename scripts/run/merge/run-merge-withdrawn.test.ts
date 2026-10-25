import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#4916: `run:merge` withdraws the lane of a child it booked withdrawn unless a
// withdrawal is already on the stream.

const events_mock = vi.hoisted(() => vi.fn())
const withdraw_mock = vi.hoisted(() => vi.fn())
const NOTE = vi.hoisted(() => 'withdrawn note')

vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { current_events: events_mock },
}))
vi.mock('#scripts/lane/lane-withdraw', () => ({
	lane_withdraw: { withdraw: withdraw_mock, describe: vi.fn().mockReturnValue(NOTE) },
}))

const { run_merge_withdrawn } = await import('./run-merge-withdrawn')

const CHILD = '4906'
const WITHDRAW_EVENT = {
	pos: 1,
	at: '2026-10-25T00:00:00.000Z',
	kind: 'withdraw',
	text: `#${CHILD} withdrawn by a person: x`,
}

beforeEach(() => {
	events_mock.mockReset().mockResolvedValue([])
	withdraw_mock.mockReset().mockResolvedValue({ kind: 'closed' })
})

describe('run_merge_withdrawn.collect', () => {
	it('withdraws the lane of a child no one withdrew, as run:merge', async () => {
		expect(await run_merge_withdrawn.collect(CHILD)).toStrictEqual({ note: NOTE, is_retry: false })
		expect(withdraw_mock).toHaveBeenCalledWith(CHILD, run_merge_withdrawn.UNMERGED_REASON, 'merge')
	})

	it('leaves a child a person already withdrew alone', async () => {
		events_mock.mockResolvedValue([WITHDRAW_EVENT])

		expect(await run_merge_withdrawn.collect(CHILD)).toStrictEqual({
			note: undefined,
			is_retry: false,
		})
		expect(withdraw_mock).not.toHaveBeenCalled()
	})

	it('asks for a retry when the withdrawal could not read the child', async () => {
		withdraw_mock.mockResolvedValue({ kind: 'unreadable' })

		expect(await run_merge_withdrawn.collect(CHILD)).toStrictEqual({ note: NOTE, is_retry: true })
	})
})
