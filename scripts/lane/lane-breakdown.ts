import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import { lane_ledger, type LedgerEntry } from './lane-ledger'
import { lane_net_time, type LaneSpan } from './lane-net-time'
import { lane_stop_stats } from './lane-stop-stats'

// A lane's net time by stage (joshuafolkken/kit#4995), read off the run events it already leaves: from
// its dispatch to its `plan`, the implementation from the `plan` (or `lane-phase implement`) to the first
// ship stage, each ship stage from its start to its end, and the time between ship stages — a stopped
// stage's fix included. The waits `lane:net` takes out are taken out of the stage they fell in and
// counted apart, so the stages add up to the net time. A cut and its resume open no stage: the
// implementation stays one stage across them.

const { EVENT_KIND } = run_event_stream
const { PHASE } = run_ship_stage

const PLAN_STAGE = 'start to plan'
const IMPLEMENT_STAGE = 'implement'
const BETWEEN_STAGE = 'between ship stages'
const SHIP_LEAD = 'ship '
const IMPLEMENT_SUFFIX = ' implement'
const PRE_DETACH_STAGE = `${SHIP_LEAD}${lane_ledger.PRE_DETACH_STAGE}`

// One stage's net milliseconds.
interface Stage {
	name: string
	ms: number
}

interface Breakdown {
	// Longest first, the waits taken out.
	stages: ReadonlyArray<Stage>
	// The waits taken out, together.
	excluded_ms: number
	// The host's sleeps among them (joshuafolkken/kit#5032).
	slept_ms: number
	// The waits taken out, each — the implementation's split leaves them out of its remainder too.
	waits: ReadonlyArray<LaneSpan>
	// The implementation's spans, waits left in — the window its tool calls are read in.
	implement: ReadonlyArray<LaneSpan>
	// The ship pre-detach stage's spans — the window its `test:pinned` rows are read in
	// (joshuafolkken/kit#5078).
	pre_detach: ReadonlyArray<LaneSpan>
}

interface Segment extends LaneSpan {
	stage: string
}

interface Marker {
	at_ms: number
	stage: string
}

function ship_stage_of(text: string): string {
	const { stage, phase } = run_ship_stage.words_of(text)

	return phase === PHASE.START ? `${SHIP_LEAD}${stage}` : BETWEEN_STAGE
}

// The stage an event opens, `undefined` for one that opens none.
function stage_of(event: RunEvent): string | undefined {
	if (event.kind === EVENT_KIND.SHIP_STAGE) return ship_stage_of(event.text)
	const is_implement =
		event.kind === EVENT_KIND.PLAN ||
		(event.kind === EVENT_KIND.LANE_PHASE && event.text.endsWith(IMPLEMENT_SUFFIX))

	return is_implement ? IMPLEMENT_STAGE : undefined
}

function is_inside(at_ms: number, span: LaneSpan): boolean {
	return at_ms >= span.from_ms && at_ms < span.to_ms
}

function marker_of(event: RunEvent, issue: number, span: LaneSpan): ReadonlyArray<Marker> {
	const stage = stage_of(event)
	const at_ms = Date.parse(event.at)
	const is_lane = lane_stop_stats.issue_of(event) === issue && is_inside(at_ms, span)

	return stage !== undefined && is_lane ? [{ at_ms, stage }] : []
}

function segments_of(
	events: ReadonlyArray<RunEvent>,
	issue: number,
	span: LaneSpan,
): Array<Segment> {
	const opened = events
		.flatMap((event) => marker_of(event, issue, span))
		.toSorted((left, right) => left.at_ms - right.at_ms)
	// A marker of the stage already open opens nothing: the `plan` and `lane-phase implement` of one
	// start, or of a resumed session, leave the implementation one span.
	const markers = [{ at_ms: span.from_ms, stage: PLAN_STAGE }, ...opened].filter(
		(marker, index, all) => marker.stage !== all[index - 1]?.stage,
	)

	return markers.map((marker, index) => ({
		stage: marker.stage,
		from_ms: marker.at_ms,
		to_ms: markers[index + 1]?.at_ms ?? span.to_ms,
	}))
}

function clipped(segment: LaneSpan, parts: ReadonlyArray<LaneSpan>): Array<LaneSpan> {
	return parts
		.map((part) => ({
			from_ms: Math.max(segment.from_ms, part.from_ms),
			to_ms: Math.min(segment.to_ms, part.to_ms),
		}))
		.filter((part) => part.to_ms > part.from_ms)
		.toSorted((left, right) => left.from_ms - right.from_ms)
}

// The milliseconds of `segment` that any of `parts` covers, each covered millisecond once — parallel
// tool calls, or a call across a wait, overlap.
function covered_ms(segment: LaneSpan, parts: ReadonlyArray<LaneSpan>): number {
	let reached_ms = segment.from_ms
	let total_ms = 0

	for (const part of clipped(segment, parts)) {
		total_ms += Math.max(0, part.to_ms - Math.max(part.from_ms, reached_ms))
		reached_ms = Math.max(reached_ms, part.to_ms)
	}

	return total_ms
}

// Each name's milliseconds summed, longest first — the stages here and the tool-call kinds of the
// implementation (`lane-breakdown-implement.ts`) alike.
function ranked(parts: ReadonlyArray<Stage>): Array<Stage> {
	const totals = new Map<string, number>()

	for (const part of parts) totals.set(part.name, (totals.get(part.name) ?? 0) + part.ms)

	return [...totals]
		.map(([name, ms]) => ({ name, ms }))
		.toSorted((left, right) => right.ms - left.ms)
}

function spans_ms(spans: ReadonlyArray<LaneSpan>): number {
	return spans.reduce((sum, span) => sum + span.to_ms - span.from_ms, 0)
}

/**
 * `issue`'s lane by stage, or `undefined` when the ledger holds no dispatch and merge of it — the same
 * span and waits `lane_net_time.net_ms` reads, so the stages add up to it.
 */
function of(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	issue: number,
): Breakdown | undefined {
	const span = lane_net_time.span_of(entries, issue)

	if (span === undefined) return undefined

	const waits = lane_net_time.waits(entries, events, issue, span)
	const segments = segments_of(events, issue, span)
	const parts = segments.map((segment) => ({
		name: segment.stage,
		ms: segment.to_ms - segment.from_ms - covered_ms(segment, waits),
	}))

	return {
		stages: ranked(parts),
		excluded_ms: spans_ms(waits),
		slept_ms: spans_ms(lane_net_time.slept(events, span)),
		waits,
		implement: segments.filter((segment) => segment.stage === IMPLEMENT_STAGE),
		pre_detach: segments.filter((segment) => segment.stage === PRE_DETACH_STAGE),
	}
}

function minutes_text(ms: number): string {
	return `${(ms / MS_PER_MINUTE).toFixed(1)} min`
}

// The longest stage in whole minutes, the words the overrun's start note carries.
function longest_of(breakdown: Breakdown): { name: string; minutes: number } | undefined {
	const [longest] = breakdown.stages

	return longest === undefined
		? undefined
		: { name: longest.name, minutes: Math.round(longest.ms / MS_PER_MINUTE) }
}

const lane_breakdown = {
	IMPLEMENT_STAGE,
	PRE_DETACH_STAGE,
	covered_ms,
	longest_of,
	minutes_text,
	of,
	ranked,
}

export { lane_breakdown }
export type { Breakdown, Stage }
