import { time_round_trips } from '#scripts/time-runtime/time-round-trips'
import { time_single_check } from '#scripts/time-runtime/time-single-check'
import type { Span } from '#scripts/time-runtime/time-spans'
import { time_distribution } from './time-distribution'
import { time_model_gaps, type ModelGap } from './time-model-gaps'
import type { RequestTokens } from './time-request-costs'

// The two per-session signals that need the time axis and the cost axis joined (joshuafolkken/kit#1970,
// a child of joshuafolkken/kit#1938).
//
// **The check loop** counts the edit-then-check cadence a session ran and reports the context it was
// carrying while it looped — how many single verification checks followed an edit, and the median
// billed input of the request in flight at those checks. The run-wide `single_checks` counter
// (`time-single-check.ts`) measures a different thing — checks that *repeat an earlier call with the
// same arguments* — so it stays; this is the per-session cadence, keyed to the context the loop cost.
//
// **The stall candidates** are model waits that ran long while returning little — a wait at least
// `STALL_MIN_WAIT_MS` that produced fewer than `STALL_MAX_TOKENS_PER_SECOND` output tokens a
// wait-second. `time-gaps.ts` already surfaces the longest waits but never joins their output tokens,
// so a long wait that wrote a large answer could not be told from one the run was parked on; this is
// that join. It names the wait and its output and stops there — the cause is not something the numbers
// can say.
//
// **Both need the cost axis, so both are withheld where it was not read.** The join reuses
// `time-request-costs.ts`'s per-session token projection rather than re-walking the corpus, and a
// scope that never loaded it (epic, last-N, history) passes no requests here, so `time-by-session.ts`
// leaves the columns off rather than printing a zero — the withheld-is-not-zero idiom the report keeps.

const NONE = 0
const MS_PER_SECOND = 1000
// A model wait at least this long is a stall candidate — ten minutes, where a run is plainly parked
// rather than thinking. A constant, so the threshold is one place a reader can find and move.
const STALL_MIN_WAIT_MS = 600_000
// ...and only when it produced fewer output tokens than this per wait-second, so a long wait that
// still wrote a large answer is left out.
const STALL_MAX_TOKENS_PER_SECOND = 5

interface CheckLoop {
	// How many single verification checks followed an edit in this session.
	count: number
	// The median billed input of the request in flight at those checks — the context the run carried
	// while it looped. Zero when no request could be placed against a check.
	median_context_tokens: number
}

interface Stall {
	started_ms: number
	ended_ms: number
	wait_ms: number
	output_tokens: number
}

interface SessionSignals {
	// Absent when the session ran no edit-then-check loop at all — the withheld-is-not-zero idiom.
	check_loop?: CheckLoop
	stalls: ReadonlyArray<Stall>
}

function is_check(span: Span): boolean {
	return span.check_key !== time_single_check.NO_CHECK
}

// The billed input of the most recent request at or before `at_ms` — the context the run was carrying
// at that instant. `requests` is sorted oldest first, so the last eligible one is the nearest.
function context_at(requests: ReadonlyArray<RequestTokens>, at_ms: number): number | undefined {
	const eligible = requests.filter(
		(request) => request.at_ms !== undefined && request.at_ms <= at_ms,
	)

	return eligible.at(-1)?.billed_input
}

interface CheckWalk {
	count: number
	contexts: Array<number>
}

function record_check(walk: CheckWalk, requests: ReadonlyArray<RequestTokens>, span: Span): void {
	walk.count += 1
	const context = context_at(requests, span.ended_ms)

	if (context !== undefined) walk.contexts.push(context)
}

// One span of the walk: an edit arms the flag, a check while it is armed is counted and disarms it.
// The returned flag is the next span's pending state, so it is the edit-then-check transitions that
// are counted rather than every check after the first edit.
function step_check(
	walk: CheckWalk,
	requests: ReadonlyArray<RequestTokens>,
	span: Span,
	has_pending_write: boolean,
): boolean {
	if (span.is_writing) return true

	if (has_pending_write && is_check(span)) {
		record_check(walk, requests, span)

		return false
	}

	return has_pending_write
}

// Walk the session in time order, counting each check that followed an edit and recording the context
// it ran at.
function walk_checks(
	spans: ReadonlyArray<Span>,
	requests: ReadonlyArray<RequestTokens>,
): CheckWalk {
	const walk: CheckWalk = { count: NONE, contexts: [] }
	let has_pending_write = false

	for (const span of time_round_trips.in_time_order(spans)) {
		has_pending_write = step_check(walk, requests, span, has_pending_write)
	}

	return walk
}

function to_check_loop(
	spans: ReadonlyArray<Span>,
	requests: ReadonlyArray<RequestTokens>,
): CheckLoop | undefined {
	const walk = walk_checks(spans, requests)

	if (walk.count === NONE) return undefined

	const median = time_distribution.build(walk.contexts).median_ms

	return { count: walk.count, median_context_tokens: Math.round(median) }
}

function delta_to(request: RequestTokens, at_ms: number): number {
	return Math.abs((request.at_ms ?? at_ms) - at_ms)
}

// The output tokens of the request whose completion is nearest this instant — the response that ended
// the wait. Nearest rather than at-or-before, because a record's `at_ms` is its last line, which lands
// at the wait's end rather than before it.
function output_near(requests: ReadonlyArray<RequestTokens>, at_ms: number): number | undefined {
	const nearest = requests
		.filter((request) => request.at_ms !== undefined)
		.toSorted((left, right) => delta_to(left, at_ms) - delta_to(right, at_ms))

	return nearest[0]?.output_tokens
}

function to_stall(gap: ModelGap, requests: ReadonlyArray<RequestTokens>): Stall | undefined {
	if (gap.duration_ms < STALL_MIN_WAIT_MS) return undefined

	const output = output_near(requests, gap.ended_ms)

	if (output === undefined) return undefined

	const per_second = output / (gap.duration_ms / MS_PER_SECOND)

	if (per_second >= STALL_MAX_TOKENS_PER_SECOND) return undefined

	return {
		started_ms: gap.started_ms,
		ended_ms: gap.ended_ms,
		wait_ms: gap.duration_ms,
		output_tokens: output,
	}
}

function to_stalls(
	spans: ReadonlyArray<Span>,
	requests: ReadonlyArray<RequestTokens>,
): Array<Stall> {
	const stalls: Array<Stall> = []

	for (const gap of time_model_gaps.issuing_model_gaps(spans)) {
		const stall = to_stall(gap, requests)

		if (stall !== undefined) stalls.push(stall)
	}

	return stalls
}

function build(spans: ReadonlyArray<Span>, requests: ReadonlyArray<RequestTokens>): SessionSignals {
	const check_loop = to_check_loop(spans, requests)
	const stalls = to_stalls(spans, requests)

	return check_loop === undefined ? { stalls } : { check_loop, stalls }
}

const time_session_signals = { STALL_MIN_WAIT_MS, STALL_MAX_TOKENS_PER_SECOND, build }

export type { CheckLoop, SessionSignals, Stall }
export { time_session_signals }
