import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import type { LaneSpan } from './lane-net-time'
import { lane_stop_stats } from './lane-stop-stats'

// The stops a lane's time between ship stages went to (joshuafolkken/kit#5646): each `park` event of
// the lane — `run:merge`'s `#<N> waiting on #<M>` for a pause on a blocker, `#<N> parked (<reason>)`
// for a park — named where it fell, so the stretch it opened (the blocker filed, the pause, the
// resume and the re-ship) is attributed to it rather than left to the Bash kinds.

const { EVENT_KIND } = run_event_stream
const IMPLEMENT_SUFFIX = ' implement'
const REPLAN_NOTE = 're-plan'
const RE_RUN_LEAD = 'ship ×'
const RE_RUN_TAIL = ' re-run'
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

// A plan, or the lane turning to implement — after a pause, the lane re-planned.
function is_planning(event: RunEvent): boolean {
	return (
		event.kind === EVENT_KIND.PLAN ||
		(event.kind === EVENT_KIND.LANE_PHASE && event.text.endsWith(IMPLEMENT_SUFFIX))
	)
}

// The ship runs counted so far, and the stages the last one started.
interface Runs {
	count: number
	started: ReadonlySet<string>
}

// A ship starts each stage once, so a stage started again opens the next run. No one stage marks a
// run's start — a resumed ship skips the stages it finished — nor does the stages' order, which
// starts gate and round-2 side by side.
function run_step(runs: Runs, stage: string): Runs {
	if (runs.count > 0 && !runs.started.has(stage)) {
		return { count: runs.count, started: new Set([...runs.started, stage]) }
	}

	return { count: runs.count + 1, started: new Set([stage]) }
}

function runs_of(events: ReadonlyArray<RunEvent>): number {
	const starts = events
		.filter((event) => event.kind === EVENT_KIND.SHIP_STAGE)
		.map((event) => run_ship_stage.words_of(event.text))
		.filter((words) => words.phase === run_ship_stage.PHASE.START)
	let runs: Runs = { count: 0, started: new Set() }

	for (const words of starts) runs = run_step(runs, words.stage)

	return runs.count
}

// What the lane redid after a pause (joshuafolkken/kit#5649): ` (re-plan, ship ×2 re-run)`, or ''.
function note_of(events: ReadonlyArray<RunEvent>): string {
	const runs = runs_of(events)
	const parts = [
		...(events.some((event) => is_planning(event)) ? [REPLAN_NOTE] : []),
		...(runs > 0 ? [`${RE_RUN_LEAD}${String(runs)}${RE_RUN_TAIL}`] : []),
	]

	return parts.length === 0 ? '' : ` (${parts.join(', ')})`
}

function between_of(events: ReadonlyArray<RunEvent>, span: LaneSpan): ReadonlyArray<RunEvent> {
	return events.filter((event) => {
		const at_ms = Date.parse(event.at)

		return at_ms > span.from_ms && at_ms <= span.to_ms
	})
}

/** `issue`'s parks inside `span`, in the stream's order, each with what the lane redid after it. */
function of(events: ReadonlyArray<RunEvent>, issue: number, span: LaneSpan): Array<PauseMark> {
	const lane = events.filter((event) => lane_stop_stats.issue_of(event) === issue)
	const marks = events
		.filter((event) => event.kind === EVENT_KIND.PARK)
		.flatMap((event) => mark_of(event, issue))
		.filter((mark) => mark.at_ms >= span.from_ms && mark.at_ms <= span.to_ms)

	return marks.map((mark, index) => {
		const after = { from_ms: mark.at_ms, to_ms: marks[index + 1]?.at_ms ?? span.to_ms }

		return { ...mark, name: `${mark.name}${note_of(between_of(lane, after))}` }
	})
}

// The park that fell inside `segment` — its first, when the lane paused twice in one stretch.
function in_segment(marks: ReadonlyArray<PauseMark>, segment: LaneSpan): PauseMark | undefined {
	return marks.find((mark) => mark.at_ms > segment.from_ms && mark.at_ms <= segment.to_ms)
}

const lane_breakdown_pause = { in_segment, is_planning, of }

export { lane_breakdown_pause }
export type { PauseMark }
