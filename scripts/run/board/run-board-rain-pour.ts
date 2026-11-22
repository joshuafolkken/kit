import { run_board_sweep } from './run-board-sweep'
import type { TypingSpan } from './run-board-type-rows'

// joshuafolkken/kit#8369: when the matrix board's rain pours, read in the drops' steps. The spans the rows
// typed over (`run_board_type_rows.spans_of`) are kept across the redraws that drop their rows and merged,
// so two rows typing at once pour once. A step pours where a span holds its first moment.

const STEP_MS = run_board_sweep.SWEEP_MS

// The index of the first step at or after `ms`.
function step_index(ms: number): number {
	return Math.ceil(ms / STEP_MS)
}

// The spans sorted, each one that overlaps or touches the span before it folded into that one.
function merged(spans: ReadonlyArray<TypingSpan>): Array<TypingSpan> {
	const sorted = spans.toSorted((left, right) => left.from_ms - right.from_ms)
	const folded: Array<TypingSpan> = []

	for (const span of sorted) {
		const last = folded.at(-1)

		if (last === undefined || span.from_ms > last.to_ms) folded.push({ ...span })
		else last.to_ms = Math.max(last.to_ms, span.to_ms)
	}

	return folded
}

// The first and past-last step indices both in `span` and in `from_ms`..`to_ms`, end excluded.
function overlap(span: TypingSpan, from_ms: number, to_ms: number): [number, number] {
	const first = step_index(Math.max(from_ms, span.from_ms))

	return [first, Math.max(first, step_index(Math.min(to_ms, span.to_ms)))]
}

// How many steps from `from_ms` up to `to_ms`, end excluded, pour.
function poured_steps(spans: ReadonlyArray<TypingSpan>, from_ms: number, to_ms: number): number {
	let count = 0

	for (const span of spans) {
		const [first, past] = overlap(span, from_ms, to_ms)

		count += past - first
	}

	return count
}

// The moment of every step from `from_ms` up to `to_ms`, end excluded, that pours.
function pour_steps(
	spans: ReadonlyArray<TypingSpan>,
	from_ms: number,
	to_ms: number,
): Array<number> {
	return spans.flatMap((span) => {
		const [first, past] = overlap(span, from_ms, to_ms)

		return Array.from({ length: past - first }, (_step, index) => (first + index) * STEP_MS)
	})
}

function is_pouring(spans: ReadonlyArray<TypingSpan>, at_ms: number): boolean {
	return spans.some((span) => span.from_ms <= at_ms && at_ms < span.to_ms)
}

const run_board_rain_pour = { is_pouring, merged, pour_steps, poured_steps }

export { run_board_rain_pour }
