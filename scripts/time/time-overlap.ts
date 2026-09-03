import type { Span } from './time-spans'

// Interval arithmetic, and the one thing it is for: not counting the same wall clock twice
// (joshuafolkken/kit#1268, joshuafolkken/kit#1285).
//
// Two readings of a run overlap by construction, and both were measured before the arithmetic was
// written. `followup --merge` waits for CI *inside* a Bash tool span, so most of a pull request's
// open→merge window is already counted as tool execution. And a session that delegates holds a tool
// span for the whole time it waits on the unit, while the unit's own transcript records the same
// wall clock as the work it actually did.
//
// **Both are the same subtraction**, which is why they are one module rather than a helper in
// `time-run.ts` and a second copy beside the delegated reader. The property they exist to preserve
// is that the four shares still add up to the elapsed time — the one thing that makes two runs
// comparable.

const NO_DURATION = 0

interface Interval {
	started_ms: number
	ended_ms: number
}

interface Walk {
	cursor: number
	parts: Array<Interval>
}

// One covered interval consumed. Every quantity is clamped into `[cursor, limit]` before it is used,
// so the walk is monotone with no branches: an interval entirely behind the cursor contributes
// nothing, one past the limit contributes nothing, and an overlapping one contributes only the gap
// in front of it.
function advance(walk: Walk, interval: Interval, limit: number): Walk {
	const start = Math.min(Math.max(interval.started_ms, walk.cursor), limit)
	const end = Math.min(Math.max(interval.ended_ms, walk.cursor), limit)
	const gap = start > walk.cursor ? [{ started_ms: walk.cursor, ended_ms: start }] : []

	return { cursor: end, parts: [...walk.parts, ...gap] }
}

// The parts of `target` that no interval in `covered` overlaps, in order and with their real
// instants.
//
// **The instants are the answer, not merely how much was left.** A caller that only subtracts a
// duration and keeps the span's original end moves the remainder to the wrong place on the timeline:
// a parent span `[0,10]` whose unit covered `[8,10]` really has `[0,8]` left, and reporting it as
// `[2,10]` moves both the run's reported start and the coverage that decides the CI wait.
function uncovered_parts(target: Interval, covered: ReadonlyArray<Interval>): Array<Interval> {
	if (target.ended_ms <= target.started_ms) return []

	const sorted = [...covered].toSorted((left, right) => left.started_ms - right.started_ms)
	let walk: Walk = { cursor: target.started_ms, parts: [] }

	for (const interval of sorted) walk = advance(walk, interval, target.ended_ms)

	if (walk.cursor >= target.ended_ms) return walk.parts

	return [...walk.parts, { started_ms: walk.cursor, ended_ms: target.ended_ms }]
}

// How much of `target` no interval in `covered` overlaps — the same walk, summed, so the two answers
// can never disagree about what was covered.
function uncovered_ms(target: Interval, covered: ReadonlyArray<Interval>): number {
	return uncovered_parts(target, covered).reduce(
		(sum, part) => sum + (part.ended_ms - part.started_ms),
		0,
	)
}

function to_interval(span: Span): Interval {
	return { started_ms: span.ended_ms - span.duration_ms, ended_ms: span.ended_ms }
}

// What is left of one parent span once the delegated work inside it is removed: the brief written
// before the call, and the result read after it.
//
// **A span covered in the middle comes back as two**, each at its real instants, rather than as one
// span whose duration was shrunk. The price is that a call bracketing a unit is counted twice in the
// per-tool table's `call_count`; the alternative prices the same fragment at the wrong minute, which
// the CI wait and the reported start of the run both read.
//
// A span left with nothing yields nothing, rather than a row saying a call took no time.
function trim(span: Span, covered: ReadonlyArray<Interval>): Array<Span> {
	return uncovered_parts(to_interval(span), covered).map((part) => ({
		...span,
		ended_ms: part.ended_ms,
		duration_ms: part.ended_ms - part.started_ms,
	}))
}

const SAME_INSTANT = 0

// Delegated spans in timeline order — earliest start first, the shorter of two spans starting
// together first, and the label last. The order is what decides which unit keeps a minute two units
// shared, so it is derived from the spans rather than left as the order the transcript directory
// happened to list the unit files in. **The label is what makes that true of two units with the very
// same interval**: without it the comparator answers equal, the sort is stable, and the survivor is
// whichever file had the older mtime.
// Compared by code point rather than `localeCompare`, whose collation is the runtime's: two units
// whose labels differ only in case or punctuation would otherwise sort one way here and the other
// on a machine with a different `LANG`, and the loser of this comparison is the one trimmed away.
function compare_labels(left: string, right: string): number {
	if (left === right) return SAME_INSTANT

	return left < right ? -1 : 1
}

function compare_spans(left: Span, right: Span): number {
	const started = to_interval(left).started_ms - to_interval(right).started_ms

	if (started !== SAME_INSTANT) return started
	if (left.ended_ms !== right.ended_ms) return left.ended_ms - right.ended_ms

	return compare_labels(left.label, right.label)
}

function in_timeline_order(spans: ReadonlyArray<Span>): Array<Span> {
	return [...spans].toSorted(compare_spans)
}

// A span of no duration covers nothing and is covered by nothing, so it is passed through rather
// than trimmed. `uncovered_parts` answers `[]` for a target with no length, and dropping such a span
// would leave a transcript's minute totals right while its `turn_count` and every `call_count`
// silently shrank — two transcript lines really can share a millisecond.
//
// **Both sides of the subtraction go through this**, parent spans included. Trimming the parent
// directly would drop its zero-duration spans exactly when the session happened to have a
// `subagents/` directory, so one transcript's turn count would depend on whether it delegated.
function reconciled(span: Span, covered: ReadonlyArray<Interval>): Array<Span> {
	return span.duration_ms === NO_DURATION ? [span] : trim(span, covered)
}

// What a set of spans covers. **A span of no duration is left out**: the walk emits the gap in front
// of every interval it consumes, so a zero-length one cuts the span enclosing it in two at that
// instant — the minutes still right, one parent tool call reported as two.
function covering_intervals(spans: ReadonlyArray<Span>): Array<Interval> {
	return spans.filter((span) => span.duration_ms !== NO_DURATION).map((span) => to_interval(span))
}

// The delegated spans with their own overlaps removed: each is kept whole except where an earlier
// one already covers it. Their union is unchanged, so what is subtracted from the parent below is
// exactly what is added back.
//
// **Keeping every unit's span whole was the defect** (joshuafolkken/kit#1287). One session running
// two units *at the same time* had the shared wall clock counted once per unit while the parent's
// bracketing span was trimmed by both, so the four shares exceeded the elapsed time — the invariant
// this module's header says it exists to hold. `epicrun` and `queue` run their children one at a
// time, so the shape appears the moment concurrent delegation does rather than today.
//
// **Which unit keeps a shared minute has no true answer** — both units really did run in it — so the
// requirement is only that the total is right and that the answer never depends on the order the
// transcripts were read in.
function without_self_overlap(delegated: ReadonlyArray<Span>): Array<Span> {
	const kept: Array<Span> = []
	const covered: Array<Interval> = []

	for (const span of in_timeline_order(delegated)) {
		const parts = reconciled(span, covered)

		kept.push(...parts)
		covered.push(...covering_intervals(parts))
	}

	return kept
}

// The parent's spans and its delegated units', joined without counting the shared wall clock twice.
//
// **The unit's spans are kept whole and the parent's are reduced**, never the other way round. The
// unit is the detail — model wait, each tool, each `pnpm josh <cmd>` — and the parent holds one
// undifferentiated `Agent` span across the same minutes. Keeping the parent's instead would report
// a delegated child as a single tool call, which is what listing only the parent already did.
// "Whole" means whole against the parent: units that overlap *each other* are reconciled first, by
// `without_self_overlap` above.
//
// **With no delegated span this is the identity**, which is the whole of the "a run that never
// delegated is unaffected" guarantee: a project with no `subagents/` directory produces an empty
// `delegated`, and the parent's spans come back untouched rather than round-tripped through the
// subtraction. Sequential delegation is untouched for the same reason: units that overlap nothing
// come back out of the reconciliation exactly as they went in.
//
// **The other overlap without a parent-unit relation is not resolved here**, because it is not an
// overlap of intervals at all: a resumed transcript copies a parent's `Agent` span into a second
// session, and the copy has to be assigned to one session *before* this subtraction runs.
// `time-duplicate.ts` is where that assignment is made, and why it cannot be a fold afterwards.
function resolve_delegated(
	parent: ReadonlyArray<Span>,
	delegated: ReadonlyArray<Span>,
): Array<Span> {
	if (delegated.length === 0) return [...parent]

	const resolved = without_self_overlap(delegated)
	const covered = covering_intervals(resolved)

	return [...parent.flatMap((span) => reconciled(span, covered)), ...resolved]
}

const time_overlap = {
	uncovered_ms,
	to_interval,
	resolve_delegated,
}

export type { Interval }
export { time_overlap }
