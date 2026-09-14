import { cost_format } from '#scripts/cost/cost-format'
import type { SessionTimeline } from './time-corpus'
import { time_format } from './time-format'
import type { RequestTokens, SessionRequests } from './time-request-costs'
import { time_round_trips } from './time-round-trips'
import { time_session_end_state, type EndState } from './time-session-end-state'
import { time_session_signals, type SessionSignals, type Stall } from './time-session-signals'
import { time_spans, type Span } from './time-spans'

// One issue's wall clock broken down by the main-line session it was spent in (joshuafolkken/kit#1912).
//
// The cost axis (`cost-sessions.ts`) says what each session cost; this says how long each took and how
// it ended. A run that stopped and resumed reads here as two rows — the first `stopped`, the second
// `merged` — where the pooled figures showed one run of unattributable minutes. The resume row also
// carries how long the resumed session spent before its first forward progress, which is the
// re-establishing-context cost the hand measurement of `fullrun #1876` had to reconstruct by eye.

const NONE = 0
const FIRST = 0
// A resumed session's first real work: an edit, or one of the workflow commands that change state.
const PROGRESS_COMMANDS = new Set(['josh gate', 'josh git', 'josh followup'])
const EDIT_MARKER = 'edit'

interface SessionTime {
	session_id: string
	// Not the first session in time order — the run was resumed into it.
	is_resumed: boolean
	elapsed_ms: number
	model_ms: number
	tool_ms: number
	round_trip_count: number
	end_state: EndState
	// A resumed session's wall clock from its first span to its first forward-progress span (an edit or
	// a state-changing josh command). Absent for the first session, and for a resume that never reached
	// one — unknown rather than zero, the withheld-is-not-zero idiom the rest of the report follows.
	to_first_progress_ms?: number
	// The two signals joined from the cost axis' tokens (joshuafolkken/kit#1970): the edit-then-check
	// loop and the long-wait-low-output stalls. Absent where the cost corpus was not read, so the
	// columns are withheld rather than shown as zero.
	signals?: SessionSignals
}

// The per-category wall clock, summing `duration_ms` exactly as `time_report.category_ms` does —
// inlined rather than imported to keep this module clear of a type cycle with `time-report.ts`, which
// carries the `by_session` field these rows fill.
function category_ms(spans: ReadonlyArray<Span>, category: string): number {
	let total = NONE

	for (const span of spans) {
		if (span.category === category) total += span.duration_ms
	}

	return total
}

function is_progress(span: Span): boolean {
	return span.is_writing || span.marker === EDIT_MARKER || PROGRESS_COMMANDS.has(span.josh_command)
}

function first_progress_ms(spans: ReadonlyArray<Span>): number | undefined {
	const ordered = time_round_trips.in_time_order(spans)
	const first = ordered[FIRST]
	const progress = ordered.find((span) => is_progress(span))

	if (first === undefined || progress === undefined) return undefined

	return time_round_trips.started_ms(progress) - time_round_trips.started_ms(first)
}

function resume_of(
	spans: ReadonlyArray<Span>,
	is_resumed: boolean,
): { to_first_progress_ms?: number } {
	if (!is_resumed) return {}

	const ms = first_progress_ms(spans)

	return ms === undefined ? {} : { to_first_progress_ms: ms }
}

function signals_of(
	spans: ReadonlyArray<Span>,
	requests: ReadonlyArray<RequestTokens> | undefined,
): { signals?: SessionSignals } {
	if (requests === undefined) return {}

	return { signals: time_session_signals.build(spans, requests) }
}

function to_session_time(
	timeline: SessionTimeline,
	is_resumed: boolean,
	requests: ReadonlyArray<RequestTokens> | undefined,
): SessionTime {
	const { spans } = timeline
	const model_ms = category_ms(spans, time_spans.MODEL_CATEGORY)
	const tool_ms = category_ms(spans, time_spans.TOOL_CATEGORY)
	const human_ms = category_ms(spans, time_spans.HUMAN_CATEGORY)

	return {
		session_id: timeline.session_id,
		is_resumed,
		elapsed_ms: model_ms + tool_ms + human_ms,
		model_ms,
		tool_ms,
		round_trip_count: time_round_trips.count_round_trips(spans),
		end_state: time_session_end_state.classify(spans),
		...resume_of(spans, is_resumed),
		...signals_of(spans, requests),
	}
}

function session_start(timeline: SessionTimeline): number {
	const starts = timeline.spans.map((span) => time_round_trips.started_ms(span))

	return starts.length === NONE ? Infinity : Math.min(...starts)
}

function requests_for(
	session_requests: ReadonlyArray<SessionRequests> | undefined,
	session_id: string,
): ReadonlyArray<RequestTokens> | undefined {
	if (session_requests === undefined) return undefined

	return session_requests.find((one) => one.session_id === session_id)?.requests ?? []
}

function build(
	by_session: ReadonlyArray<SessionTimeline>,
	session_requests?: ReadonlyArray<SessionRequests>,
): Array<SessionTime> {
	const ordered = [...by_session].toSorted(
		(left, right) => session_start(left) - session_start(right),
	)

	return ordered.map((timeline, index) =>
		to_session_time(timeline, index > FIRST, requests_for(session_requests, timeline.session_id)),
	)
}

const HEADING = 'By main-line session (oldest first):'

function resume_text(session: SessionTime): string {
	if (session.to_first_progress_ms === undefined) return ''

	return ` · to first progress ${time_format.format_minutes(session.to_first_progress_ms)}`
}

function check_loop_text(session: SessionTime): string {
	const loop = session.signals?.check_loop

	if (loop === undefined) return ''

	const context = cost_format.format_tokens(loop.median_context_tokens)

	return ` · ${String(loop.count)} check-loop(s), median context ${context} tok`
}

function session_line(session: SessionTime): string {
	const elapsed = time_format.format_minutes(session.elapsed_ms)
	const trips = `${String(session.round_trip_count)} round trip(s)`
	const tail = `${resume_text(session)}${check_loop_text(session)}`

	return `  ${session.session_id}  ${elapsed} · ${trips} · ${session.end_state.state}${tail}`
}

function stall_line(stall: Stall): string {
	const window = time_format.format_window(stall.started_ms, stall.ended_ms)
	const wait = time_format.format_minutes(stall.wait_ms)
	const output = cost_format.format_tokens(stall.output_tokens)

	return `      stall ${window} · ${wait} · ${output} out tok`
}

function stall_lines(session: SessionTime): Array<string> {
	return (session.signals?.stalls ?? []).map((stall) => stall_line(stall))
}

function session_block(session: SessionTime): Array<string> {
	return [session_line(session), ...stall_lines(session)]
}

function session_lines(by_session: ReadonlyArray<SessionTime> | undefined): Array<string> {
	if (by_session === undefined || by_session.length === NONE) return []

	return ['', HEADING, ...by_session.flatMap((one) => session_block(one))]
}

const time_by_session = { HEADING, build, session_lines }

export type { SessionTime }
export { time_by_session }
