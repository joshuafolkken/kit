import { lane_host_gaps } from '#scripts/lane/lane-host-gaps'
import type { LaneSpan } from '#scripts/lane/lane-net-time'
import { lane_offline_spans } from '#scripts/lane/lane-offline-spans'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_progress } from '#scripts/run/progress/run-progress'
import { run_board_ending_states } from './run-board-ending-states'

// **The `📈 throughput` figures, folded on as the stream grows** (joshuafolkken/kit#8039): the board
// reads the stream every few seconds, and re-folding all of it each time was most of a local read
// (joshuafolkken/kit#8037). The fold holds what the cells need — the alive stretches, joined where they
// meet, the last event, and the close and host-stop lines — and folds on only the events past the ones
// it holds. A stream that is not the held one grown (another run, a bound that dropped a line, a whole
// re-read) or a line dated before the last folded one (a merge dated back, `run-merge-dated.ts`) folds
// whole again. What ended `RETAIN_MS` before the newest event is let go, so the fold stays the size of
// the window, not of the stream.

interface Span {
	start_ms: number
	end_ms: number
}

interface Mark {
	ms: number
	is_halt: boolean
}

interface Fold {
	// The stream folded, by its length and its first and last event: the tail reader hands back the same
	// event objects while the prefix it read holds (`run-event-tail.ts`).
	count: number
	first: RunEvent | undefined
	tail: RunEvent | undefined
	// Oldest first, never touching: a stretch that meets the newest is joined onto it.
	spans: Array<Span>
	last: Mark | undefined
	// The close and host-stop lines, in stream order.
	kept: Array<RunEvent>
}

interface FoldRead {
	spans: ReadonlyArray<Span>
	closes: ReadonlyArray<number>
	// The host's stops, never active (joshuafolkken/kit#7905).
	gaps: ReadonlyArray<LaneSpan>
}

const KIND = run_event_stream.EVENT_KIND
// A run beats every progress interval, so a quiet stretch longer than two of them is a stopped one.
const BEATS_PER_GAP = 2
const MAX_GAP_MS = BEATS_PER_GAP * run_progress.DEFAULT_INTERVAL_MS
// The run's own ending: a stop or a stranding that names no child.
const HALT_KINDS: ReadonlySet<string> = new Set([KIND.STOP, KIND.STRANDED])
// The `7d` row reaches back seven days (an hour more across a clock change); a day past it keeps an
// outage begun before the window whole where it enters it.
const RETAIN_DAYS = 8
const MINUTES_PER_DAY = 1440
const RETAIN_MS = RETAIN_DAYS * MINUTES_PER_DAY * MS_PER_MINUTE

const held: { fold: Fold | undefined } = { fold: undefined }

function moment(event: RunEvent): number {
	return Date.parse(event.at)
}

function is_halt(event: RunEvent): boolean {
	return HALT_KINDS.has(event.kind) && run_event_scope.issue_named(event) === undefined
}

function is_kept(event: RunEvent): boolean {
	if (run_board_ending_states.is_close(event)) return true

	return event.kind === KIND.SLEEP || lane_offline_spans.is_turn(event.kind)
}

// Whether the run was alive from `last` until `end_ms`.
function is_alive(last: Mark | undefined, end_ms: number): last is Mark {
	return last !== undefined && !last.is_halt && end_ms - last.ms <= MAX_GAP_MS
}

function join(spans: Array<Span>, start_ms: number, end_ms: number): void {
	const newest = spans.at(-1)

	if (newest?.end_ms === start_ms) newest.end_ms = end_ms
	else spans.push({ start_ms, end_ms })
}

// Folds `event` on in time order; `false`, folding nothing, for one dated before the last.
function step(fold: Fold, event: RunEvent): boolean {
	const mark = { ms: moment(event), is_halt: is_halt(event) }

	if (fold.last !== undefined && mark.ms < fold.last.ms) return false

	if (is_alive(fold.last, mark.ms)) join(fold.spans, fold.last.ms, mark.ms)

	fold.last = mark

	return true
}

function let_go(fold: Fold): void {
	const since_ms = (fold.last?.ms ?? 0) - RETAIN_MS
	const ended = fold.spans.findIndex((span) => span.end_ms >= since_ms)

	fold.spans.splice(0, ended === -1 ? fold.spans.length : ended)
	fold.kept = fold.kept.filter((event) => moment(event) >= since_ms)
}

function settled(fold: Fold, events: ReadonlyArray<RunEvent>): Fold {
	fold.count = events.length
	fold.first = events[0]
	fold.tail = events.at(-1)
	let_go(fold)
	held.fold = fold

	return fold
}

// In time order, not stream order: a merge is dated back to its ship's report (`run-merge-dated.ts`), so
// it lands after lines newer than itself (joshuafolkken/kit#6677). A later line keeps its stream place
// among equal moments.
function whole(events: ReadonlyArray<RunEvent>): Fold {
	const fold: Fold = {
		count: 0,
		first: undefined,
		tail: undefined,
		spans: [],
		last: undefined,
		kept: events.filter((event) => is_kept(event)),
	}
	const timed = events.toSorted((left, right) => moment(left) - moment(right))

	for (const event of timed) step(fold, event)

	return settled(fold, events)
}

function is_grown(fold: Fold | undefined, events: ReadonlyArray<RunEvent>): fold is Fold {
	if (fold === undefined || events.length < fold.count) return false

	return fold.count === 0 || (events[0] === fold.first && events[fold.count - 1] === fold.tail)
}

// Folds the events past the held fold onto it; `false` for one dated before the last, the held fold
// then spoilt for a whole fold to replace.
function grown_by(fold: Fold, fresh: ReadonlyArray<RunEvent>): boolean {
	if (fresh.some((event) => !step(fold, event))) return false

	fold.kept.push(...fresh.filter((event) => is_kept(event)))

	return true
}

/** The fold of `events`: the held one grown by the events past it, or a whole fold. */
function fold_of(events: ReadonlyArray<RunEvent>): Fold {
	const prior = held.fold

	if (!is_grown(prior, events)) return whole(events)

	if (prior.count === events.length) return prior

	return grown_by(prior, events.slice(prior.count)) ? settled(prior, events) : whole(events)
}

function close_entry(event: RunEvent): ReadonlyArray<[string, number]> {
	const issue = run_event_scope.issue_named(event)

	return issue === undefined ? [] : [[issue, moment(event)]]
}

// Each child's close, where the `✅ done` section draws it merged; a later close of the same child wins.
function close_times(events: ReadonlyArray<RunEvent>): ReadonlyArray<number> {
	const closes = events.filter((event) => run_board_ending_states.is_close(event))

	return [...new Map(closes.flatMap((event) => close_entry(event))).values()]
}

/** When the run on `events` was alive (the last stretch running on to `now_ms`), each child's close and the host's stops. */
function read_of(events: ReadonlyArray<RunEvent>, now_ms: number): FoldRead {
	const { spans, last, kept } = fold_of(events)
	const running = is_alive(last, now_ms) ? [{ start_ms: last.ms, end_ms: now_ms }] : []

	return {
		spans: [...spans, ...running],
		closes: close_times(kept),
		gaps: lane_host_gaps.gaps_of(kept),
	}
}

const run_board_throughput_fold = { RETAIN_MS, fold_of, read_of }

export { run_board_throughput_fold }
export type { Fold, FoldRead, Span }
