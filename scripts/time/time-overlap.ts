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

// The parent's spans and its delegated units', joined without counting the shared wall clock twice.
//
// **The unit's spans are kept whole and the parent's are reduced**, never the other way round. The
// unit is the detail — model wait, each tool, each `pnpm josh <cmd>` — and the parent holds one
// undifferentiated `Agent` span across the same minutes. Keeping the parent's instead would report
// a delegated child as a single tool call, which is what listing only the parent already did.
//
// **With no delegated span this is the identity**, which is the whole of the "a run that never
// delegated is unaffected" guarantee: a project with no `subagents/` directory produces an empty
// `delegated`, and the parent's spans come back untouched rather than round-tripped through the
// subtraction.
//
// **Two cases this does not resolve, both recorded rather than silently assumed away.** One session
// running two units *at the same time* has each unit's spans counted whole while the parent's
// bracketing spans are trimmed by both, so the shares can exceed the window — `epicrun` and `queue`
// run their children one at a time, so this is a shape the workflow does not currently produce. And
// a resumed transcript that copies a parent's `Agent` span into a session with no units of its own
// keeps that copy whole while the original is trimmed away, and the two no longer share a span key,
// so the cross-transcript dedupe cannot collapse them. Deciding which of the two copies the units
// belong to is a judgement rather than an oversight; both are filed as follow-ups to
// joshuafolkken/kit#1285.
function resolve_delegated(
	parent: ReadonlyArray<Span>,
	delegated: ReadonlyArray<Span>,
): Array<Span> {
	if (delegated.length === 0) return [...parent]

	const covered = delegated.map((span) => to_interval(span))

	return [...parent.flatMap((span) => trim(span, covered)), ...delegated]
}

const time_overlap = {
	uncovered_ms,
	to_interval,
	resolve_delegated,
}

export type { Interval }
export { time_overlap }
