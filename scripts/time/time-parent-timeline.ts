import { cost_format } from '#scripts/cost/cost-format'
import { time_background } from './time-background'
import { time_command_key } from './time-command-key'
import { time_distribution } from './time-distribution'
import { time_format } from './time-format'
import { time_markers } from './time-markers'
import { time_parent_turns } from './time-parent-turns'
import { time_region_costs, type LabeledRegion, type PricedRequest } from './time-region-costs'
import { time_round_trips } from './time-round-trips'
import { time_spans, type Span } from './time-spans'

// A `backlogrun` parent's own timeline — when it first dispatched a lane, what it waited on in the
// foreground while lanes sat free, and the work it implemented itself (joshuafolkken/kit#1940).
//
// The hand measurement of the 2026-09-13 `backlogrun` (joshuafolkken/kit#1936's split rationale)
// found two costs `josh time` could not print: 18 minutes before the first lane started — a
// foreground `followup` that timed out at 600 s while no new lane was dispatched — and the parent
// implementing a parked child itself at ~290k carried context. `parent_turns` says *what kind* of
// turn there were most of; this says *when* the parent's own minutes went, which the turn counts
// cannot.
//
// **The three signals are read off spans the report already has, and two helpers it already owns.**
// A dispatch is a span whose command is `josh lane:dispatch` — read from the call the parent made,
// never a second copy of `lane:dispatch`'s own decision about whether to dispatch. The cost of the
// implementation turns is `time-region-costs.ts`'s bucket arithmetic and their context is
// `time-distribution.ts`'s median, so neither is re-derived here.
//
// **Identifying *which* session is the parent is a later child's** (the run-tree scope, filed
// afterward): this block computes and renders from a parent's spans and priced requests once handed
// them, and `time-run.ts` wires it to the run's spans until that scope arrives.

const NONE = 0
const NO_MS = 0
const COST_DECIMALS = 2

// The command a dispatch is, read from the call rather than re-judged. `command_key` returns the
// `josh` subcommand where a span ran one, so a `pid=$(pnpm josh lane:dispatch "$n")` reads as this.
const LANE_DISPATCH = 'josh lane:dispatch'
// What a parent waits on in the *foreground*, blocking a lane that could have started: `followup`
// stays in the foreground by design (`background-commands.md`), and a bare `sleep` is the poll or the
// timeout the hand measurement caught at 600 s. Backgrounded commands are excluded below, so a
// `followup` a run detached does not count.
const WAIT_COMMANDS: ReadonlySet<string> = new Set(['josh followup', 'Bash: sleep'])
const { IMPLEMENTATION } = time_parent_turns

// When each lane started, and how long the run took to start the first. `is_measured` is not
// `has_dispatch`: a transcript that was never read and a run that dispatched no lane both total zero
// dispatches, and the renderer prints `no lane dispatched` for the second only once the first is
// ruled out — the withheld-is-not-zero idiom the rest of the report follows.
interface Dispatch {
	at_ms: number
	offset_ms: number
	issue: number
}

interface DispatchTiming {
	is_measured: boolean
	has_dispatch: boolean
	first_offset_ms: number
	dispatches: Array<Dispatch>
}

// One foreground wait: the window it occupied and the command the parent sat on.
interface ForegroundWait {
	started_ms: number
	ended_ms: number
	duration_ms: number
	command: string
}

interface ForegroundWaits {
	is_measured: boolean
	waits: Array<ForegroundWait>
	total_ms: number
}

// What the parent implemented itself, rather than dispatching: how many requests those turns billed,
// what they cost, the median context they carried, and which issue the work was for. `is_measured`
// is false where the cost corpus was not read — the request count and dollars come from it, so the
// block is withheld rather than shown as zero, the way `contributor_costs` is.
interface ImplementationTurns {
	is_measured: boolean
	request_count: number
	cost_usd: number
	median_context_tokens: number
	context_sample_count: number
	issues: Array<number>
}

interface ParentTimeline {
	dispatch: DispatchTiming
	foreground_waits: ForegroundWaits
	implementation: ImplementationTurns
}

function run_start_ms(spans: ReadonlyArray<Span>): number {
	const starts = spans.map((span) => time_round_trips.started_ms(span))

	return starts.length === NONE ? NO_MS : Math.min(...starts)
}

function is_dispatch(span: Span): boolean {
	return time_command_key.command_key(span) === LANE_DISPATCH
}

function to_dispatch(span: Span, start_ms: number): Dispatch {
	const at_ms = time_round_trips.started_ms(span)

	return { at_ms, offset_ms: at_ms - start_ms, issue: span.issue }
}

function build_dispatch(spans: ReadonlyArray<Span>): DispatchTiming {
	const is_measured = time_spans.has_transcript_data(spans.length)
	const start_ms = run_start_ms(spans)
	const dispatches = spans
		.filter((span) => is_dispatch(span))
		.map((span) => to_dispatch(span, start_ms))
		.toSorted((left, right) => left.at_ms - right.at_ms)

	return {
		is_measured,
		has_dispatch: dispatches.length > NONE,
		first_offset_ms: dispatches[0]?.offset_ms ?? NO_MS,
		dispatches,
	}
}

// A foreground wait is a tool span the run neither backgrounded nor read a background command in, on
// one of the waiting commands. The two background fields are what tell a foreground `followup` from
// one a run detached, and `is_continuation` drops the tail of a call trimmed around a delegation.
function is_foreground_wait(span: Span): boolean {
	if (span.is_continuation) return false
	if (span.background_id !== time_background.NO_BACKGROUND) return false
	if (span.background_command !== time_background.NO_BACKGROUND) return false

	return WAIT_COMMANDS.has(time_command_key.command_key(span))
}

function to_wait(span: Span): ForegroundWait {
	return {
		started_ms: time_round_trips.started_ms(span),
		ended_ms: span.ended_ms,
		duration_ms: span.duration_ms,
		command: time_command_key.command_key(span),
	}
}

function build_foreground_waits(spans: ReadonlyArray<Span>): ForegroundWaits {
	const waits = spans
		.filter((span) => is_foreground_wait(span))
		.map((span) => to_wait(span))
		.toSorted((left, right) => left.started_ms - right.started_ms)
	const total_ms = waits.reduce((sum, wait) => sum + wait.duration_ms, NO_MS)

	return { is_measured: time_spans.has_transcript_data(spans.length), waits, total_ms }
}

function trip_region(trip: ReadonlyArray<Span>): LabeledRegion {
	const starts = trip.map((span) => time_round_trips.started_ms(span))
	const ends = trip.map((span) => span.ended_ms)

	return { start_ms: Math.min(...starts), end_ms: Math.max(...ends), label: IMPLEMENTATION }
}

// The wall-clock windows the parent's own implementation turns occupied, labelled so the shared
// bucket arithmetic and the region test below both name them one way.
function implementation_regions(spans: ReadonlyArray<Span>): Array<LabeledRegion> {
	return time_round_trips
		.group_round_trips(spans)
		.filter((trip) => time_parent_turns.contributor_of_trip(trip) === IMPLEMENTATION)
		.map((trip) => trip_region(trip))
}

function is_in_regions(span: Span, regions: ReadonlyArray<LabeledRegion>): boolean {
	return regions.some(
		(region) => span.ended_ms >= region.start_ms && span.ended_ms <= region.end_ms,
	)
}

function implementation_issues(
	spans: ReadonlyArray<Span>,
	regions: ReadonlyArray<LabeledRegion>,
): Array<number> {
	const issues = spans
		.filter((span) => span.issue !== time_markers.NO_ISSUE && is_in_regions(span, regions))
		.map((span) => span.issue)

	return [...new Set(issues)].toSorted((left, right) => left - right)
}

// The context each implementation-turn request carried, so their median is the spread this block
// reports. `billed_input` is the size the cost axis already computed; the distribution helper is
// reused rather than a second median written beside it.
function implementation_contexts(
	regions: ReadonlyArray<LabeledRegion>,
	requests: ReadonlyArray<RequestContext>,
): Array<number> {
	const sorted = regions.toSorted((left, right) => left.end_ms - right.end_ms)

	return requests
		.filter((request) => time_region_costs.label_at(sorted, request.at_ms) !== undefined)
		.map((request) => request.billed_input)
}

// The two request facts this block reads, one per source: the price for the dollars, the context for
// the median. Kept minimal so a caller hands over what `time-request-costs.ts` already holds.
interface RequestContext {
	at_ms: number | undefined
	billed_input: number
}

interface ImplementationInput {
	spans: ReadonlyArray<Span>
	priced: ReadonlyArray<PricedRequest> | undefined
	requests: ReadonlyArray<RequestContext> | undefined
}

const UNMEASURED_IMPLEMENTATION: ImplementationTurns = {
	is_measured: false,
	request_count: NONE,
	cost_usd: NONE,
	median_context_tokens: NO_MS,
	context_sample_count: NONE,
	issues: [],
}

// The build once both sources are known present, so the guard's narrowing hands over non-optional
// arrays and nothing here re-checks them. The empty bucket is the region-cost module's own, so a run
// whose implementation turns billed nothing reads a measured zero rather than a withheld one.
function measured_implementation(
	spans: ReadonlyArray<Span>,
	priced: ReadonlyArray<PricedRequest>,
	requests: ReadonlyArray<RequestContext>,
): ImplementationTurns {
	const regions = implementation_regions(spans)
	const bucket =
		time_region_costs.tally(regions, priced).by_label.get(IMPLEMENTATION) ??
		time_region_costs.EMPTY_BUCKET
	const context = time_distribution.build(implementation_contexts(regions, requests))

	return {
		is_measured: true,
		request_count: bucket.request_count,
		cost_usd: bucket.cost_usd,
		median_context_tokens: context.median_ms,
		context_sample_count: context.sample_count,
		issues: implementation_issues(spans, regions),
	}
}

// Measured only where the cost corpus was read: the request count and dollars come from the priced
// requests and the context from the per-request tokens, so both sources have to be present. The two
// cheap `undefined` checks lead, before the span walk that answers whether a transcript was read.
function build_implementation(input: ImplementationInput): ImplementationTurns {
	const { spans, priced, requests } = input

	if (
		priced === undefined ||
		requests === undefined ||
		!time_spans.has_transcript_data(spans.length)
	) {
		return UNMEASURED_IMPLEMENTATION
	}

	return measured_implementation(spans, priced, requests)
}

function build_parent_timeline(input: ImplementationInput): ParentTimeline {
	return {
		dispatch: build_dispatch(input.spans),
		foreground_waits: build_foreground_waits(input.spans),
		implementation: build_implementation(input),
	}
}

const DISPATCH_HEADING = 'Parent — first lane dispatch:'
const WAITS_HEADING = 'Parent — foreground waits (in run order):'
const IMPLEMENTATION_HEADING = 'Parent — own implementation:'
const FIRST_DISPATCH_LABEL = 'time to first dispatch'
const DISPATCH_LABEL = 'Parent dispatch'
const WAIT_LABEL = 'Parent foreground waits'
const IMPLEMENTATION_LABEL = 'Parent implementation'
const TOTAL_LABEL = 'total'
const REQUESTS_LABEL = 'requests'
const COST_LABEL = 'cost'
const MEDIAN_CONTEXT_LABEL = 'median context'
const NO_DISPATCH = 'no lane dispatched'
const NO_WAIT = 'no foreground wait'
const NO_IMPLEMENTATION = 'the parent implemented nothing itself'
const AFTER_START = 'after run start'
const NO_ISSUE_TEXT = 'issue not declared'

const { format_minutes, format_row, format_columns, unmeasured_row } = time_format

function lanes_text(count: number): string {
	return `${String(count)} lane(s) dispatched`
}

function dispatch_row(dispatch: Dispatch): string {
	const label =
		dispatch.issue === time_markers.NO_ISSUE
			? DISPATCH_LABEL
			: `dispatch #${String(dispatch.issue)}`

	return format_columns(label, format_minutes(dispatch.offset_ms), AFTER_START)
}

function dispatch_lines(timing: DispatchTiming): Array<string> {
	const heading = ['', DISPATCH_HEADING]

	if (!timing.is_measured) return [...heading, unmeasured_row(DISPATCH_LABEL)]
	if (!timing.has_dispatch) return [...heading, `  ${NO_DISPATCH}`]

	const first = format_columns(
		FIRST_DISPATCH_LABEL,
		format_minutes(timing.first_offset_ms),
		lanes_text(timing.dispatches.length),
	)

	return [...heading, first, ...timing.dispatches.map((dispatch) => dispatch_row(dispatch))]
}

function wait_row(wait: ForegroundWait): string {
	return format_row(
		time_format.format_window(wait.started_ms, wait.ended_ms),
		wait.duration_ms,
		wait.command,
	)
}

function wait_total(waits: ReadonlyArray<ForegroundWait>, total_ms: number): string {
	return format_columns(TOTAL_LABEL, format_minutes(total_ms), `${String(waits.length)} wait(s)`)
}

function foreground_wait_lines(waits: ForegroundWaits): Array<string> {
	const heading = ['', WAITS_HEADING]

	if (!waits.is_measured) return [...heading, unmeasured_row(WAIT_LABEL)]
	if (waits.waits.length === NONE) return [...heading, `  ${NO_WAIT}`]

	const rows = waits.waits.map((wait) => wait_row(wait))

	return [...heading, ...rows, wait_total(waits.waits, waits.total_ms)]
}

function issues_text(issues: ReadonlyArray<number>): string {
	if (issues.length === NONE) return NO_ISSUE_TEXT

	const list = issues.map((issue) => `#${String(issue)}`).join(', ')

	return `for ${list}`
}

function context_text(count: number): string {
	return `${String(count)} request(s)`
}

function implementation_rows(turns: ImplementationTurns): Array<string> {
	const context = `${cost_format.format_tokens(turns.median_context_tokens)} tok`

	return [
		format_columns(REQUESTS_LABEL, String(turns.request_count), issues_text(turns.issues)),
		format_columns(COST_LABEL, time_format.usd(turns.cost_usd, COST_DECIMALS), ''),
		format_columns(MEDIAN_CONTEXT_LABEL, context, context_text(turns.context_sample_count)),
	]
}

function implementation_lines(turns: ImplementationTurns): Array<string> {
	const heading = ['', IMPLEMENTATION_HEADING]

	if (!turns.is_measured) return [...heading, unmeasured_row(IMPLEMENTATION_LABEL)]
	if (turns.request_count === NONE) return [...heading, `  ${NO_IMPLEMENTATION}`]

	return [...heading, ...implementation_rows(turns)]
}

// Withheld whole where no scope built it, the way `time_by_session.session_lines` withholds its
// table: a single-session or epic report carries no parent, so it prints none of the three blocks.
function parent_timeline_lines(timeline: ParentTimeline | undefined): Array<string> {
	if (timeline === undefined) return []

	return [
		...dispatch_lines(timeline.dispatch),
		...foreground_wait_lines(timeline.foreground_waits),
		...implementation_lines(timeline.implementation),
	]
}

const time_parent_timeline = {
	DISPATCH_HEADING,
	WAITS_HEADING,
	IMPLEMENTATION_HEADING,
	NO_DISPATCH,
	NO_WAIT,
	NO_IMPLEMENTATION,
	LANE_DISPATCH,
	WAIT_COMMANDS,
	build_parent_timeline,
	parent_timeline_lines,
}

export type { ImplementationInput, ParentTimeline, RequestContext }
export { time_parent_timeline }
