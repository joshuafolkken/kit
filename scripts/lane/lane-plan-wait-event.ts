import { issue_cite } from '#scripts/issue/issue-cite'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import type { LaneSpan } from './lane-net-time'

// A lane's `lane:plan` blocking on a holder of its files (joshuafolkken/kit#6140): each ask that waits
// writes a `plan-wait` start and end, so `lane:breakdown` counts the wait under `lane:plan wait (#<M>)`
// rather than under the stage it fell in — a wait after a stopped ship read as its pre-detach.

const { EVENT_KIND } = run_event_stream

const START = 'start'
const END = 'end'
// `#<N> start #<M>` / `#<N> end #<M>`: the waiting lane, the phase, the holder.
const TEXT = /^#(?<issue>[1-9]\d*) (?<phase>start|end) (?<holder>#[1-9]\d*)$/u

interface WaitPair {
	issue: number
	holder: number
}

// One wait, and the row it is counted under.
interface PlanWait extends LaneSpan {
	name: string
}

interface Named extends LaneSpan {
	stage: string
}

function text_of(pair: WaitPair, phase: string): string {
	return `${issue_cite.plain_for('program', pair.issue)} ${phase} ${issue_cite.plain_for('program', pair.holder)}`
}

/** Run `wait` between a `plan-wait` start and end of `pair`, written best-effort. */
async function timed<T>(pair: WaitPair, wait: () => Promise<T>): Promise<T> {
	await run_event_stream_emit.emit(EVENT_KIND.PLAN_WAIT, text_of(pair, START))

	try {
		return await wait()
	} finally {
		await run_event_stream_emit.emit(EVENT_KIND.PLAN_WAIT, text_of(pair, END))
	}
}

interface Mark {
	at_ms: number
	phase: string
	holder: string
}

// The lane, phase and holder a `plan-wait` event names, none for another kind.
function words_of(event: RunEvent): ReadonlyArray<string> {
	if (event.kind !== EVENT_KIND.PLAN_WAIT) return []

	return TEXT.exec(event.text)?.slice(1) ?? []
}

function mark_of(event: RunEvent, issue: number): ReadonlyArray<Mark> {
	const [lane, phase = '', holder = ''] = words_of(event)

	if (Number(lane) !== issue) return []

	return [{ at_ms: Date.parse(event.at), phase, holder }]
}

// The wait `end` closes, where the mark before it is its holder's start.
function pair_of(start: Mark | undefined, end: Mark): ReadonlyArray<PlanWait> {
	if (end.phase !== END || start?.phase !== START || start.holder !== end.holder) return []

	return [
		{
			from_ms: start.at_ms,
			to_ms: end.at_ms,
			name: `lane:plan wait (${end.holder})`,
		},
	]
}

/** `issue`'s waits on `events`, oldest first — each end closing the start before it of its holder. */
function spans(events: ReadonlyArray<RunEvent>, issue: number): Array<PlanWait> {
	const marks = events
		.flatMap((event) => mark_of(event, issue))
		.toSorted((left, right) => left.at_ms - right.at_ms)

	return marks.flatMap((mark, index) => pair_of(marks[index - 1], mark))
}

function inside_of(segment: LaneSpan, waits: ReadonlyArray<PlanWait>): Array<PlanWait> {
	return waits
		.map((wait) => ({
			...wait,
			from_ms: Math.max(segment.from_ms, wait.from_ms),
			to_ms: Math.min(segment.to_ms, wait.to_ms),
		}))
		.filter((wait) => wait.to_ms > wait.from_ms)
}

// `segment` with each wait inside it cut out as a stage of the wait's row.
function carved_one<S extends Named>(segment: S, waits: ReadonlyArray<PlanWait>): Array<S> {
	const parts: Array<S> = []
	let { from_ms } = segment

	for (const wait of inside_of(segment, waits)) {
		if (wait.from_ms > from_ms) parts.push({ ...segment, from_ms, to_ms: wait.from_ms })
		parts.push({ ...segment, stage: wait.name, from_ms: wait.from_ms, to_ms: wait.to_ms })
		from_ms = wait.to_ms
	}

	return from_ms < segment.to_ms ? [...parts, { ...segment, from_ms }] : parts
}

/** `segments` with every wait cut out of the stage it fell in, as a stage of its own. */
function carved<S extends Named>(
	segments: ReadonlyArray<S>,
	waits: ReadonlyArray<PlanWait>,
): Array<S> {
	return segments.flatMap((segment) => carved_one(segment, waits))
}

const lane_plan_wait_event = { carved, spans, timed }

export { lane_plan_wait_event }
export type { PlanWait, WaitPair }
