import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive_trace } from './backlog-drive-trace'

// joshuafolkken/kit#6677: the driver's collect and launch of a child are opened and closed on the
// stream, so a wait between a child's finish and its collection names what the driver was doing.

const ISSUE = '6537'
const { LANE_PHASE } = run_event_stream.EVENT_KIND

function emitted(): ReadonlyArray<string> {
	return vi.mocked(run_event_stream_emit.emit).mock.calls.map(([, text]) => text)
}

beforeEach(() => {
	// The checkout's stream is a live run's: never written from a test.
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('backlog_drive_trace.traced', () => {
	it('opens the step before it runs and closes it after (ac-192b5cfb)', async () => {
		const run = vi.fn(async (): Promise<string> => {
			expect(emitted()).toStrictEqual([`#${ISSUE} collect start`])

			return 'merged'
		})

		await expect(
			backlog_drive_trace.traced(ISSUE, backlog_drive_trace.STEP.COLLECT, run),
		).resolves.toBe('merged')
		expect(emitted()).toStrictEqual([`#${ISSUE} collect start`, `#${ISSUE} collect done`])
		expect(run_event_stream_emit.emit).toHaveBeenCalledWith(LANE_PHASE, `#${ISSUE} collect done`)
	})

	it('closes a throwing step as failed and rethrows its error', async () => {
		const failure = new Error('launch broke')

		await expect(
			backlog_drive_trace.traced(ISSUE, backlog_drive_trace.STEP.LAUNCH, async () => {
				throw failure
			}),
		).rejects.toBe(failure)
		expect(emitted()).toStrictEqual([`#${ISSUE} launch start`, `#${ISSUE} launch failed`])
	})
})
