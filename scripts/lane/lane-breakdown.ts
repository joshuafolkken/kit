import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import { lane_breakdown_pause, type PauseMark } from './lane-breakdown-pause'
import { lane_ledger, type LedgerEntry } from './lane-ledger'
import { lane_net_time, type LaneSpan } from './lane-net-time'
import { lane_plan_wait_event } from './lane-plan-wait-event'
import { lane_stop_stats } from './lane-stop-stats'
import { lane_yield_split, type YieldShare } from './lane-yield-split'

// A lane's net time by stage (joshuafolkken/kit#4995), read off the run events it already leaves: from
// its dispatch to its `plan`, the implementation from the `plan` (or `lane-phase implement`, or else
// the first edit) to the first ship stage, each ship stage from its start to its end, and the time
// between ship stages — a stopped stage's fix included. The waits `lane:net` takes out are taken out of the stage they fell in and
// counted apart, so the stages add up to the net time; the ship's followup is a driver stage outside it. A cut and its resume open no stage: the
// implementation stays one stage across them.

const { EVENT_KIND } = run_event_stream
const { PHASE } = run_ship_stage

const PLAN_STAGE = 'start to plan'
const IMPLEMENT_STAGE = 'implement'
const BETWEEN_STAGE = 'between ship stages'
// A ship stop's marker before `closed` reads it — never a stage.
const STOP_MARK = 'stop'
const SHIP_LEAD = 'ship '
const PRE_DETACH_STAGE = `${SHIP_LEAD}${lane_ledger.PRE_DETACH_STAGE}`
const FOLLOWUP_STAGE = `${SHIP_LEAD}${run_ship_stage.STAGE.FOLLOWUP}`
const ROUND_TWO_STAGE = `${SHIP_LEAD}${run_ship_stage.STAGE.ROUND_TWO}`
// The ship's followup, outside the lane's net time (joshuafolkken/kit#6541).
const DRIVER_FOLLOWUP_STAGE = `driver ${run_ship_stage.STAGE.FOLLOWUP}`

// One stage's net milliseconds.
interface Stage {
	name: string
	ms: number
}

interface Breakdown {
	// Longest first, the waits and the driver's followup taken out.
	stages: ReadonlyArray<Stage>
	// The driver's followup outside the waits — CI, CodeRabbit and the merge, no lane seat held — or
	// empty without one.
	driver?: ReadonlyArray<Stage>
	// The waits taken out, together.
	excluded_ms: number
	// The host's sleeps among them (joshuafolkken/kit#5032).
	slept_ms: number
	// The yields' waits for a redispatch among them (joshuafolkken/kit#5216).
	yield_ms: number
	// That yield wait split into the holder's remaining time and the redispatch gap
	// (joshuafolkken/kit#6006).
	yield_split?: YieldShare
	// The waits taken out, each — the implementation's split leaves them out of its remainder too.
	waits: ReadonlyArray<LaneSpan>
	// The start-to-plan spans, waits left in — the window its longest calls are read in
	// (joshuafolkken/kit#5539).
	plan?: ReadonlyArray<LaneSpan>
	// The implementation's spans, waits left in — the window its tool calls are read in.
	implement: ReadonlyArray<LaneSpan>
	// The ship pre-detach stage's spans — the window its `test:pinned` rows are read in
	// (joshuafolkken/kit#5078).
	pre_detach: ReadonlyArray<LaneSpan>
	// Each ship stage's spans and the spans between them, waits left in — the windows its laps and the
	// fixes between stages are read in (joshuafolkken/kit#5294).
	ship: ReadonlyArray<Segment>
	// Every stage's spans in time order, waits left in, each with its net milliseconds — the rows
	// `lane:breakdown --timeline` prints (joshuafolkken/kit#7186).
	segments?: ReadonlyArray<NetSegment>
	// The lane's parks, each naming the stretch between ship stages it fell in (joshuafolkken/kit#5646).
	pauses?: ReadonlyArray<PauseMark>
	// Why each ship stage last ran or was skipped, where its event line said (joshuafolkken/kit#5296).
	reasons?: ReadonlyMap<string, string>
}

interface Segment extends LaneSpan {
	stage: string
}

// A segment and its length less what the time outside the lane covers of it.
interface NetSegment extends Segment {
	net_ms: number
}

// A ship stage's name, or the between-ship-stages bucket's.
function is_ship_stage(name: string): boolean {
	return name.startsWith(SHIP_LEAD) || name === BETWEEN_STAGE
}

function is_ship(segment: Segment): boolean {
	return is_ship_stage(segment.stage)
}

interface Marker {
	at_ms: number
	stage: string
}

interface Records {
	entries: ReadonlyArray<LedgerEntry>
	events: ReadonlyArray<RunEvent>
}

function ship_stage_of(text: string): string {
	const { stage, phase } = run_ship_stage.words_of(text)

	return phase === PHASE.START ? `${SHIP_LEAD}${stage}` : BETWEEN_STAGE
}

// The stage an event opens, `undefined` for one that opens none.
function stage_of(event: RunEvent): string | undefined {
	if (event.kind === EVENT_KIND.SHIP_STAGE) return ship_stage_of(event.text)

	return lane_breakdown_pause.is_planning(event) ? IMPLEMENT_STAGE : undefined
}

function is_inside(at_ms: number, span: LaneSpan): boolean {
	return at_ms >= span.from_ms && at_ms < span.to_ms
}

function is_lane_event(event: RunEvent, issue: number, span: LaneSpan): boolean {
	return lane_stop_stats.issue_of(event) === issue && is_inside(Date.parse(event.at), span)
}

function marker_of(event: RunEvent, issue: number, span: LaneSpan): ReadonlyArray<Marker> {
	const stage = stage_of(event)
	const at_ms = Date.parse(event.at)

	return stage !== undefined && is_lane_event(event, issue, span) ? [{ at_ms, stage }] : []
}

function reason_of(event: RunEvent, issue: number, span: LaneSpan): Array<[string, string]> {
	if (event.kind !== EVENT_KIND.SHIP_STAGE || !is_lane_event(event, issue, span)) return []

	const reason = run_ship_stage.reason_of(event.text)
	const stage = `${SHIP_LEAD}${run_ship_stage.words_of(event.text).stage}`

	return reason === undefined ? [] : [[stage, reason]]
}

// The newest reason each ship stage's event line gave, by the stage's name.
function reasons_of(
	events: ReadonlyArray<RunEvent>,
	issue: number,
	span: LaneSpan,
): Map<string, string> {
	const ordered = events.toSorted((left, right) => Date.parse(left.at) - Date.parse(right.at))

	return new Map(ordered.flatMap((event) => reason_of(event, issue, span)))
}

// Whether a lane's first edit opens the implementation: no `plan` / `lane-phase implement` marker did,
// and the edit came before the first stage another event opened.
function opens_implement(opened: ReadonlyArray<Marker>, edit_ms: number): boolean {
	const [first] = opened

	if (opened.some((marker) => marker.stage === IMPLEMENT_STAGE)) return false

	return first === undefined || edit_ms < first.at_ms
}

// The implementation's marker at the lane's first edit, where no event marked it — a docs-only lane
// writes no runtime file, so its edits never write the `plan` / `lane-phase implement` events
// (joshuafolkken/kit#5835).
function edit_markers(
	opened: ReadonlyArray<Marker>,
	span: LaneSpan,
	edit_ms: number | undefined,
): Array<Marker> {
	if (edit_ms === undefined || !is_inside(edit_ms, span)) return []

	return opens_implement(opened, edit_ms) ? [{ at_ms: edit_ms, stage: IMPLEMENT_STAGE }] : []
}

function stop_of(entry: LedgerEntry, issue: number, span: LaneSpan): ReadonlyArray<Marker> {
	if (entry.kind !== lane_ledger.KIND.STOP || entry.issue !== issue) return []
	const at_ms = Date.parse(entry.at)

	return is_inside(at_ms, span) ? [{ at_ms, stage: STOP_MARK }] : []
}

// A ship's stop closes the ship stage open at it (joshuafolkken/kit#6140) — a preflight stop writes
// no stage of its own after its `pre-detach start` — and opens nothing anywhere else.
function closing(marker: Marker, before: Marker | undefined): ReadonlyArray<Marker> {
	if (marker.stage !== STOP_MARK) return [marker]
	if (before?.stage.startsWith(SHIP_LEAD) !== true) return []

	return [{ ...marker, stage: BETWEEN_STAGE }]
}

function closed(markers: ReadonlyArray<Marker>): Array<Marker> {
	return markers.flatMap((marker, index) => closing(marker, markers[index - 1]))
}

// The stages the lane's events and ship stops opened, in time order.
function opened_of(records: Records, issue: number, span: LaneSpan): Array<Marker> {
	const events = records.events.flatMap((event) => marker_of(event, issue, span))
	const stops = records.entries.flatMap((entry) => stop_of(entry, issue, span))

	return closed([...events, ...stops].toSorted((left, right) => left.at_ms - right.at_ms))
}

function segments_of(
	opened: ReadonlyArray<Marker>,
	span: LaneSpan,
	edit_ms: number | undefined,
): Array<Segment> {
	// A marker of the stage already open opens nothing: the `plan` and `lane-phase implement` of one
	// start, or of a resumed session, leave the implementation one span.
	const markers = [
		{ at_ms: span.from_ms, stage: PLAN_STAGE },
		...edit_markers(opened, span, edit_ms),
		...opened,
	].filter((marker, index, all) => marker.stage !== all[index - 1]?.stage)

	return markers.map((marker, index) => ({
		stage: marker.stage,
		from_ms: marker.at_ms,
		to_ms: markers[index + 1]?.at_ms ?? span.to_ms,
	}))
}

// The lane's stages as spans, each `lane:plan` wait cut out as a stage of its own.
function lane_segments(
	records: Records,
	issue: number,
	span: LaneSpan,
	edit_ms: number | undefined,
): Array<Segment> {
	const segments = segments_of(opened_of(records, issue, span), span, edit_ms)

	return lane_plan_wait_event.carved(segments, lane_plan_wait_event.spans(records.events, issue))
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

type Windows = Pick<Breakdown, 'plan' | 'implement' | 'pre_detach' | 'ship'>

// The stages' spans each later read is windowed by.
function windows_of(segments: ReadonlyArray<Segment>): Windows {
	return {
		plan: segments.filter((segment) => segment.stage === PLAN_STAGE),
		implement: segments.filter((segment) => segment.stage === IMPLEMENT_STAGE),
		pre_detach: segments.filter((segment) => segment.stage === PRE_DETACH_STAGE),
		ship: segments.filter((segment) => is_ship(segment)),
	}
}

// The yields' wait inside `span`, and its split into the holder's remaining time and the redispatch
// gap — the yields whose wait began inside it.
function yields_of(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	issue: number,
	span: LaneSpan,
): Pick<Breakdown, 'yield_ms' | 'yield_split'> {
	const splits = lane_yield_split
		.issue_parts(entries, events, issue)
		.filter((split) => is_inside(split.wait.from_ms, span))

	return {
		yield_ms: spans_ms(lane_net_time.yielded(entries, events, issue, span)),
		yield_split: lane_yield_split.share_of(splits),
	}
}

// Each segment less what `outside` covers of it, longest first. The followup stage is all driver
// time, so it is left out rather than listed at zero.
function net_segments_of(
	segments: ReadonlyArray<Segment>,
	outside: ReadonlyArray<LaneSpan>,
): Array<NetSegment> {
	return segments.map((segment) => ({
		...segment,
		net_ms: segment.to_ms - segment.from_ms - covered_ms(segment, outside),
	}))
}

function stages_of(segments: ReadonlyArray<NetSegment>): Array<Stage> {
	const parts = segments.map((segment) => ({ name: segment.stage, ms: segment.net_ms }))

	return ranked(parts.filter((part) => part.name !== FOLLOWUP_STAGE))
}

function driver_of(ms: number): Array<Stage> {
	return ms > 0 ? [{ name: DRIVER_FOLLOWUP_STAGE, ms }] : []
}

/**
 * `issue`'s lane by stage, or `undefined` when the ledger holds no dispatch and merge of it — the same
 * span and intervals `lane_net_time.net_ms` reads, so the stages add up to it and the driver's followup
 * stands apart. `edit_ms`, the lane's first edit, opens the implementation where no event did.
 */
function of(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	issue: number,
	edit_ms?: number,
): Breakdown | undefined {
	const span = lane_net_time.span_of(entries, issue)

	if (span === undefined) return undefined

	const waits = lane_net_time.waits(entries, events, issue, span)
	const outside = lane_net_time.outside(entries, events, issue, span)
	const segments = lane_segments({ entries, events }, issue, span, edit_ms)
	const net_segments = net_segments_of(segments, outside)

	return {
		stages: stages_of(net_segments),
		driver: driver_of(spans_ms(outside) - spans_ms(waits)),
		excluded_ms: spans_ms(waits),
		slept_ms: spans_ms(lane_net_time.slept(events, span)),
		...yields_of(entries, events, issue, span),
		waits,
		segments: net_segments,
		...windows_of(segments),
		reasons: reasons_of(events, issue, span),
		pauses: lane_breakdown_pause.of(events, issue, span),
	}
}

// The stage `at_ms` fell in — the plan, the implementation or a ship stage, by the spans `of` cut — or
// `undefined` outside them; `josh cost:audit` attributes a request's tokens by it
// (joshuafolkken/kit#5936).
function stage_at(breakdown: Breakdown, at_ms: number): string | undefined {
	const plan = (breakdown.plan ?? []).map((span) => ({ ...span, stage: PLAN_STAGE }))
	const implement = breakdown.implement.map((span) => ({ ...span, stage: IMPLEMENT_STAGE }))
	const segments = [...plan, ...implement, ...breakdown.ship]

	return segments.find((segment) => is_inside(at_ms, segment))?.stage
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
	BETWEEN_STAGE,
	DRIVER_FOLLOWUP_STAGE,
	FOLLOWUP_STAGE,
	IMPLEMENT_STAGE,
	PLAN_STAGE,
	PRE_DETACH_STAGE,
	ROUND_TWO_STAGE,
	covered_ms,
	is_ship_stage,
	longest_of,
	minutes_text,
	of,
	ranked,
	stage_at,
}

export { lane_breakdown }
export type { Breakdown, Segment, Stage }
