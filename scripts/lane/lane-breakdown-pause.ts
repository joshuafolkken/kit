import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import type { LaneSpan } from './lane-net-time'

// The stops a lane's time between ship stages went to (joshuafolkken/kit#5646): each `park` event of
// the lane — `run:merge`'s `#<N> waiting on #<M>` for a pause on a blocker, `#<N> parked (<reason>)`
// for a park — named where it fell, so the stretch it opened (the blocker filed, the pause, the
// resume and the re-ship) is attributed to it rather than left to the Bash kinds.

const WAITING_LEAD = 'waiting on '
const PARKED_LEAD = 'parked'
// A park event names its child first, then what it parked on.
const PARK_TEXT = /^#(?<issue>[1-9]\d*) (?<rest>.*)$/u

// Where a park fell in the lane, and the row it names.
interface PauseMark {
	at_ms: number
	name: string
}

// `pause for #5582` for a wait on blockers, `park (<reason>)` for a park, else no row.
function name_of(rest: string): string | undefined {
	if (rest.startsWith(WAITING_LEAD)) return `pause for ${rest.slice(WAITING_LEAD.length)}`
	if (rest.startsWith(PARKED_LEAD)) return `park${rest.slice(PARKED_LEAD.length)}`

	return undefined
}

// What `issue`'s park event says it parked on, `undefined` for another lane's park.
function rest_of(event: RunEvent, issue: number): string | undefined {
	const groups = PARK_TEXT.exec(event.text)?.groups

	return Number(groups?.['issue']) === issue ? groups?.['rest'] : undefined
}

function mark_of(event: RunEvent, issue: number): ReadonlyArray<PauseMark> {
	const name = name_of(rest_of(event, issue) ?? '')

	return name === undefined ? [] : [{ at_ms: Date.parse(event.at), name }]
}

/** `issue`'s parks inside `span`, in the stream's order. */
function of(events: ReadonlyArray<RunEvent>, issue: number, span: LaneSpan): Array<PauseMark> {
	return events
		.filter((event) => event.kind === run_event_stream.EVENT_KIND.PARK)
		.flatMap((event) => mark_of(event, issue))
		.filter((mark) => mark.at_ms >= span.from_ms && mark.at_ms <= span.to_ms)
}

// The park that fell inside `segment` — its first, when the lane paused twice in one stretch.
function in_segment(marks: ReadonlyArray<PauseMark>, segment: LaneSpan): PauseMark | undefined {
	return marks.find((mark) => mark.at_ms > segment.from_ms && mark.at_ms <= segment.to_ms)
}

const lane_breakdown_pause = { in_segment, of }

export { lane_breakdown_pause }
export type { PauseMark }
