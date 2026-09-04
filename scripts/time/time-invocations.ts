import { time_command_key } from './time-command-key'
import { time_format } from './time-format'
import { time_round_trips } from './time-round-trips'
import { time_spans, type Span } from './time-spans'

// What each call of a repeated command cost, one by one (joshuafolkken/kit#1311).
//
// `by_josh_command` prints a total and a call count, and a reader cannot tell from those whether a
// command is getting slower or faster: `josh gate 4 call(s), 2.2 min` is the same row whether the
// four runs were even or whether the last one took three times the first. The hand-built report epic
// #1262 was filed from did say — "82.6 / 79.2 / 72.2 / 67.2 s" — and that sequence is what showed the
// first run was overlapping the review and effectively free.
//
// **Only commands called more than once appear.** A row listing one duration says exactly what the
// per-command table already said, and the question here is the comparison between calls.
//
// **A call is not a span.** One call bracketing a delegated unit comes back from `time_overlap.trim`
// as a head and a tail, and listing both would report a run as having called a command more often
// than it did — the same double count `time-round-trips.ts` and `time-failures.ts` already refuse.
// The two fragments are rejoined by the `call_id` joshuafolkken/kit#1309 put on every span, which is
// the only thing that can tell them from a *different* call of the same tool.

const HEADING = 'Per invocation (repeated commands):'
// Below this a command was called once, and one duration is what the per-command table already prints.
const REPEATED_MINIMUM = 2
// How many of a row's durations are printed before the rest are counted instead. A run edits fifty
// files, and fifty durations on one line is a row nobody reads — the same reason the tables above it
// are capped at all. The whole list stays in `--json`.
const MAX_DURATIONS = 10
const DURATION_SEPARATOR = ', '
const NO_DURATION = 0

interface InvocationTotal {
	label: string
	duration_ms: number
	call_count: number
	// Each call's own duration, in the order the calls went out. Run order rather than descending,
	// because the comparison the row exists for is against the call before it.
	durations_ms: Array<number>
}

// One call, before the calls are grouped by what they ran.
interface Call {
	key: string
	duration_ms: number
}

// Where a call's head sits in the list, so its tail can be added to it. Keyed by `call_id` rather
// than by command: two `Task` calls issued in one turn — which the turn-batching rule actively
// encourages — are both split, so the walk is `A head, B head, …, A tail, B tail` and a per-command
// slot would have been overwritten before the first tail read it.
type CallIndex = Map<string, number>

function is_counted(span: Span): boolean {
	if (span.category !== time_spans.TOOL_CATEGORY) return false

	return time_command_key.command_key(span) !== time_command_key.UNNAMED_KEY
}

// A tail's head, or `undefined` when this span opens a call of its own. A span carrying no `call_id`
// never matches: the empty string would otherwise pool every unmatched fragment into one call.
function head_index(index_of: ReadonlyMap<string, number>, span: Span): number | undefined {
	if (!span.is_continuation || span.call_id === '') return undefined

	return index_of.get(span.call_id)
}

function open_call(calls: Array<Call>, index_of: CallIndex, span: Span): void {
	if (span.call_id !== '') index_of.set(span.call_id, calls.length)

	calls.push({ key: time_command_key.command_key(span), duration_ms: span.duration_ms })
}

function fold_call(calls: Array<Call>, index_of: CallIndex, span: Span): void {
	const at = head_index(index_of, span)
	const head = at === undefined ? undefined : calls[at]

	if (head === undefined) {
		open_call(calls, index_of, span)

		return
	}

	head.duration_ms += span.duration_ms
}

function empty_total(label: string): InvocationTotal {
	return { label, duration_ms: NO_DURATION, call_count: 0, durations_ms: [] }
}

function accumulate(totals: Map<string, InvocationTotal>, call: Call): void {
	const row = totals.get(call.key) ?? empty_total(call.key)

	row.duration_ms += call.duration_ms
	row.call_count += 1
	row.durations_ms.push(call.duration_ms)
	totals.set(call.key, row)
}

function grouped(calls: ReadonlyArray<Call>): Array<InvocationTotal> {
	const totals = new Map<string, InvocationTotal>()
	const rows: Array<InvocationTotal> = []

	for (const call of calls) accumulate(totals, call)
	// Drained with a loop rather than a spread: `Iterator#toArray` is not in this project's TS lib,
	// the same reason `time-report.ts` drains its own totals map this way.
	for (const [, row] of totals) rows.push(row)

	return rows
}

// **Ordered before it is walked, not assumed ordered.** The durations are printed in run order, and a
// delegated unit's spans are appended after the parent's — walked in array order, a row would list
// its calls in an order the run never made.
function collect_calls(spans: ReadonlyArray<Span>): Array<Call> {
	const calls: Array<Call> = []
	const index_of: CallIndex = new Map()

	for (const span of time_round_trips.in_time_order(spans)) {
		if (is_counted(span)) fold_call(calls, index_of, span)
	}

	return calls
}

function build_invocations(spans: ReadonlyArray<Span>): Array<InvocationTotal> {
	return grouped(collect_calls(spans))
		.filter((row) => row.call_count >= REPEATED_MINIMUM)
		.toSorted((left, right) => right.duration_ms - left.duration_ms)
}

function durations_text(durations_ms: ReadonlyArray<number>): string {
	const shown = durations_ms.slice(0, MAX_DURATIONS).map((ms) => time_format.format_seconds(ms))
	const hidden = durations_ms.length - shown.length
	const listed = shown.join(DURATION_SEPARATOR)

	return hidden === 0 ? listed : `${listed}, +${String(hidden)} more`
}

function invocation_row(row: InvocationTotal): string {
	const calls = `${String(row.call_count)} call(s): ${durations_text(row.durations_ms)}`

	return time_format.format_row(row.label, row.duration_ms, calls)
}

// Nothing at all where no command was called twice, which is the common answer for a short run: a
// heading over an empty table asserts that the question was asked and came back blank.
function invocation_lines(rows: ReadonlyArray<InvocationTotal>): Array<string> {
	if (rows.length === 0) return []

	const shown = rows.slice(0, time_format.MAX_ROWS).map((row) => invocation_row(row))

	return ['', HEADING, ...shown, ...time_format.overflow_line(rows.length)]
}

const time_invocations = {
	HEADING,
	MAX_DURATIONS,
	REPEATED_MINIMUM,
	build_invocations,
	invocation_lines,
}

export type { InvocationTotal }
export { time_invocations }
