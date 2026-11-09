import { RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { issue_park } from '#scripts/issue/issue-park'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_stalled } from './run-stalled'

// One `run:stalled` park, written in one place (joshuafolkken/kit#6878): the label, the comment the
// caller words, and the park event `run:board` reads. The ship supervisor's cap and `backlog:drive`'s
// refused launch both park through it.

const { PARK } = run_event_stream.EVENT_KIND

// The label is what keeps the issue from being re-dispatched, so no event is written without it.
// `fields.stop` keeps a ship stop beside the event's text (joshuafolkken/kit#6864).
async function apply(
	issue: string,
	comment: string,
	cause: string,
	fields: Pick<RunEvent, 'stop'> = {},
): Promise<boolean> {
	const park_write = await issue_park.apply(issue, RUN_STALLED_LABEL, comment)

	if (!park_write.is_labelled) return false

	await run_event_stream_emit.emit(PARK, run_stalled.park_event(issue, cause), new Date(), fields)

	return true
}

const run_stalled_park = { apply }

export { run_stalled_park }
