import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lane_child_marker } from './lane-child-marker'
import { lane_phase } from './lane-phase'

// joshuafolkken/kit#3444: the `implement` phase is written for a dispatched lane child only, so a
// person's session or a leaked mark never draws a phase onto a lane the board shows.

vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit: vi.fn().mockResolvedValue(undefined) },
}))

const { run_event_stream_emit } = await import('#scripts/run/event/run-event-stream-emit')
const emit = vi.mocked(run_event_stream_emit.emit)

const ISSUE = '3444'
const LANE = `/home/dev/.kit-lanes/${ISSUE}`

afterEach(() => {
	emit.mockClear()
})

describe('mark_implement', () => {
	it('writes the implement phase for the lane child of this checkout', async () => {
		await lane_phase.mark_implement(LANE, { [lane_child_marker.KEY]: ISSUE })

		expect(emit).toHaveBeenCalledExactlyOnceWith(
			run_event_stream.EVENT_KIND.LANE_PHASE,
			`#${ISSUE} implement`,
		)
	})

	it('writes nothing for a person session with no mark', async () => {
		await lane_phase.mark_implement(LANE, {})

		expect(emit).not.toHaveBeenCalled()
	})

	it('writes nothing for a mark leaked from another lane', async () => {
		await lane_phase.mark_implement(LANE, { [lane_child_marker.KEY]: '9999' })

		expect(emit).not.toHaveBeenCalled()
	})

	it('writes nothing in a checkout that is not a lane', async () => {
		await lane_phase.mark_implement('/home/dev/repo', { [lane_child_marker.KEY]: ISSUE })

		expect(emit).not.toHaveBeenCalled()
	})
})
