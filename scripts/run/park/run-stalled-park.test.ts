import { RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { issue_park } from '#scripts/issue/issue-park'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_stalled_park } from './run-stalled-park'

// joshuafolkken/kit#6878: one `run:stalled` park — the label, the comment and the park event.

const ISSUE = '6878'
const COMMENT = 'Parked.'
const CAUSE = 'launch failed'

afterEach(() => {
	vi.restoreAllMocks()
})

function spied(is_labelled: boolean): ReturnType<typeof vi.spyOn> {
	vi.spyOn(issue_park, 'apply').mockResolvedValue({ is_labelled, is_commented: is_labelled })

	return vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
}

describe('run_stalled_park.apply', () => {
	it('labels the issue run:stalled with the comment and writes the park event', async () => {
		const emit = spied(true)

		await expect(run_stalled_park.apply(ISSUE, COMMENT, CAUSE)).resolves.toBe(true)
		expect(issue_park.apply).toHaveBeenCalledWith(ISSUE, RUN_STALLED_LABEL, COMMENT)
		expect(emit).toHaveBeenCalledWith(
			run_event_stream.EVENT_KIND.PARK,
			`#${ISSUE} parked (run:stalled: ${CAUSE})`,
			expect.any(Date),
			{},
		)
	})

	it('writes no park event when the label could not be applied', async () => {
		const emit = spied(false)

		await expect(run_stalled_park.apply(ISSUE, COMMENT, CAUSE)).resolves.toBe(false)
		expect(emit).not.toHaveBeenCalled()
	})
})
