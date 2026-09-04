import { cost_blocks } from '#scripts/cost/cost-blocks'
import { time_round_trips } from './time-round-trips'
import { time_spans, type TranscriptLine } from './time-spans'

// The round-trip density a run can be told **while it is still running** (joshuafolkken/kit#1329).
//
// `time-round-trips.ts` already computes the number this reads, and `josh time` already warns on it
// — after the run has ended. Measured on run #1299, that report changed nothing: the density stayed
// at 1.08 with 159 of 172 tool-issuing turns making a single call, because the norm
// joshuafolkken/kit#1304 shipped as prose in `CLAUDE.md` reaches a reader who has already finished.
// What was missing is the number arriving in time to change the next turn.
//
// **The density is `time_round_trips`, reused rather than restated.** A second calculation here
// would be the clone `CLAUDE.md` prohibits, and worse than an ordinary one: the live line and the
// end-of-run report would come to disagree about the very quantity the change is measured on.
//
// **The turn's own call count is read from the transcript, not inferred from timing.** Guessing turn
// boundaries from the gaps between calls would make the signal a heuristic about the thing it is
// trying to correct — a slow turn would look batched and a fast pair would look like one turn. Claude
// Code writes one line per content block with the assistant message's id on each, so the exact count
// is the `tool_use` blocks across the lines carrying the newest id.

// How many round trips the window must hold before it is allowed to say anything. A tail that caught
// three calls has no density worth quoting, and a warning drawn from one is noise the reader learns
// to skip — which costs more than the line saves.
const MIN_ROUND_TRIPS = 10
// At most one line per this interval, per checkout. The line lands in the run's context and stays
// there, so a reminder with no throttle would spend exactly the budget joshuafolkken/kit#1322 is
// about: 65 edits of run #1299 would have carried 65 copies of it. Five minutes is roughly 30 round
// trips at
// the 9.7s each cost in that run — often enough to reach the phase that is drifting, rare enough that
// a whole run pays well under a thousand tokens for the feedback.
const NOTICE_INTERVAL_MS = 300_000
// The count that means "this turn batched nothing". Zero is not that: it means the newest assistant
// message could not be identified, and a run is never told off on an unread transcript.
const ONE_CALL = 1
const NONE = 0

// What one look at the transcript tail found. `round_trip_count` rides along because the line quotes
// it — a density without the sample it was taken over cannot be judged by whoever reads it.
interface DensityReading {
	density: number
	round_trip_count: number
	turn_calls: number
}

// **A tail whose final line does not parse is not read at all.** That is the shape a transcript
// caught mid-append has, and the line it truncates belongs to the *newest* turn — the one the count
// is about. Dropping the torn line the way an unparseable leading line is dropped would read a turn
// of `[thinking, tool_use, tool_use]` as one call and warn a turn that batched, which is the advice
// inverted. Withholding is the only answer that cannot be wrong. The leading line is a different
// case: it belongs to a turn already long past, and no count is taken from it.
function has_whole_tail(text: string): boolean {
	const last = text.split('\n').findLast((line) => line.trim() !== '')

	return last !== undefined && time_spans.parse_line(last) !== undefined
}

function assistant_lines(text: string): Array<TranscriptLine> {
	return text
		.split('\n')
		.map((line) => time_spans.parse_line(line))
		.filter((line): line is TranscriptLine => line?.type === time_spans.ASSISTANT_TYPE)
}

// The tool calls the newest assistant message issued, or `NONE` when there is no message to read.
//
// **Grouped by message id rather than taken off the last line.** One line holds one content block, so
// a turn that thought and then issued three calls is four lines; reading only the last of them would
// report every turn as having made exactly one call, which is the very verdict this line delivers.
// A line written without an id is left ungrouped for the same reason — every such line shares the
// empty string, and a bucket spanning the whole file would answer with the window's total.
function last_turn_calls(text: string): number {
	if (!has_whole_tail(text)) return NONE

	const lines = assistant_lines(text)
	const message_id = lines.at(-1)?.message_id

	if (message_id === undefined || message_id === time_spans.NO_MESSAGE_ID) return NONE

	return lines
		.filter((line) => line.message_id === message_id)
		.flatMap((line) => line.blocks)
		.filter((block) => block.type === cost_blocks.TOOL_USE_TYPE).length
}

// The reading over whatever stretch of transcript was handed in. The caller passes a tail rather than
// the whole file, so this is deliberately a *recent* density: a run that batched for its first hour
// and stopped is one the line should still reach.
function read_window(text: string): DensityReading {
	const { spans } = time_spans.parse_timeline(text)
	const round_trip_count = time_round_trips.count_round_trips(spans)
	const call_count = time_round_trips.count_calls(spans)

	return {
		density: time_round_trips.per_round_trip(call_count, round_trip_count),
		round_trip_count,
		turn_calls: last_turn_calls(text),
	}
}

// Four conditions, and each one withholds the line for a different reason: too little evidence, a
// turn that did batch, a run already clearing the floor, and one told recently enough.
//
// **The floor is `time_round_trips.is_below_floor`, not a threshold of its own.** The end-of-run
// warning and this line have to fire on the same runs, or a run is told it is fine while the report
// it gets afterwards says it was not.
function is_due(reading: DensityReading, since_last_ms: number): boolean {
	if (reading.round_trip_count < MIN_ROUND_TRIPS) return false
	if (reading.turn_calls !== ONE_CALL) return false
	if (!time_round_trips.is_below_floor(reading.density)) return false

	return since_last_ms >= NOTICE_INTERVAL_MS
}

// One line, and it says three things: what the density is, what it is being measured against, and
// what to do differently. The instruction is last because it is the only part worth acting on, and it
// names the resident rule rather than restating it — the rule is already in the run's context, and a
// second wording of it would be a clone that can drift.
function format_notice(reading: DensityReading): string {
	const density = time_round_trips.format_density(reading.density)
	const floor = time_round_trips.format_density(time_round_trips.CALLS_PER_ROUND_TRIP_FLOOR)

	return (
		`⚠ batching: ${density} calls per round trip over the last ${String(reading.round_trip_count)}, ` +
		`under the ${floor} floor, and this turn issued one call. ` +
		`Independent reads, greps, gh queries and edits go out together — CLAUDE.md → ` +
		`"Put every call that does not depend on another's result in the same turn".`
	)
}

const time_density = {
	MIN_ROUND_TRIPS,
	NOTICE_INTERVAL_MS,
	format_notice,
	is_due,
	last_turn_calls,
	read_window,
}

export type { DensityReading }
export { time_density }
