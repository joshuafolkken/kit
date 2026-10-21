import { lane_ledger } from '#scripts/lane/lane-ledger'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_ship_pre_detach_timed } from './run-ship-pre-detach-timed'

// joshuafolkken/kit#4382: the pre-detach checks are timed into the lane ledger and marked on the event
// stream, start and end.

const ISSUE = '4382'
const { SHIP_STAGE } = run_event_stream.EVENT_KIND

beforeEach(() => {
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue(undefined)
	vi.spyOn(lane_ledger, 'record_stage').mockResolvedValue(undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_ship_pre_detach_timed.checks', () => {
	it('marks the start and the end, and times the checks as the pre-detach stage', async () => {
		const result = { code: 0, out: 'pre-detach checks passed' }

		await expect(run_ship_pre_detach_timed.checks(ISSUE, async () => result)).resolves.toBe(result)

		expect(vi.mocked(run_event_stream_emit.emit).mock.calls).toStrictEqual([
			[SHIP_STAGE, '#4382 pre-detach start'],
			[SHIP_STAGE, '#4382 pre-detach done'],
		])
		expect(vi.mocked(lane_ledger.record_stage).mock.calls[0]?.[0]).toMatchObject({
			stage: 'pre-detach',
			issue: Number(ISSUE),
		})
	})

	it('marks checks that failed as failed, timed all the same', async () => {
		await run_ship_pre_detach_timed.checks(ISSUE, async () => ({ code: 1, out: 'red' }))

		expect(run_event_stream_emit.emit).toHaveBeenLastCalledWith(
			SHIP_STAGE,
			'#4382 pre-detach failed',
		)
		expect(lane_ledger.record_stage).toHaveBeenCalledOnce()
	})
})
