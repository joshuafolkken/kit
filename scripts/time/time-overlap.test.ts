import { describe, expect, it } from 'vitest'
import { time_overlap } from './time-overlap'
import type { Span } from './time-spans'

const MINUTE_MS = 60_000

function span(label: string, ended_minute: number, duration_minutes: number): Span {
	return {
		category: 'tool',
		label,
		josh_command: '',
		marker: 'none',
		branch: 'main',
		ended_ms: ended_minute * MINUTE_MS,
		duration_ms: duration_minutes * MINUTE_MS,
	}
}

function total_ms(spans: ReadonlyArray<Span>): number {
	return spans.reduce((sum, one) => sum + one.duration_ms, 0)
}

describe('time_overlap.uncovered_ms', () => {
	// The property the whole join rests on. `followup --merge` waits for CI inside a Bash tool span
	// that is already counted, so adding the pull request's window whole would count it twice and
	// leave the four shares summing to more than the run took.
	it('subtracts the part of the window a span already covers', () => {
		const uncovered = time_overlap.uncovered_ms({ started_ms: 0, ended_ms: 10 }, [
			{ started_ms: 2, ended_ms: 6 },
		])

		expect(uncovered).toBe(6)
	})

	it('merges overlapping and out-of-order covers rather than double-subtracting', () => {
		const uncovered = time_overlap.uncovered_ms({ started_ms: 0, ended_ms: 10 }, [
			{ started_ms: 4, ended_ms: 8 },
			{ started_ms: 2, ended_ms: 6 },
		])

		expect(uncovered).toBe(4)
	})

	it('ignores a cover that lies entirely outside the window', () => {
		const uncovered = time_overlap.uncovered_ms({ started_ms: 10, ended_ms: 20 }, [
			{ started_ms: 0, ended_ms: 5 },
			{ started_ms: 40, ended_ms: 50 },
		])

		expect(uncovered).toBe(10)
	})

	it('answers zero for a window with no length', () => {
		expect(time_overlap.uncovered_ms({ started_ms: 5, ended_ms: 5 }, [])).toBe(0)
	})
})

describe('time_overlap.resolve_delegated', () => {
	// The guarantee that a run which never delegated reports exactly as it did before: with no
	// delegated span the subtraction is never reached at all.
	it('returns the parent spans untouched when nothing was delegated', () => {
		const parent = [span('Read', 3, 1), span('Bash: git', 5, 2)]

		expect(time_overlap.resolve_delegated(parent, [])).toStrictEqual(parent)
	})

	// The parent holds one `Agent` span for the whole time the unit runs, and the unit's transcript
	// records those same minutes as the work it did. Ten minutes of wall clock must stay ten.
	it('does not count the wall clock twice when a unit covers the parent wait', () => {
		const resolved = time_overlap.resolve_delegated(
			[span('Agent', 10, 10)],
			[span('Read', 4, 4), span('Bash: pnpm', 10, 6)],
		)

		expect(total_ms(resolved)).toBe(10 * MINUTE_MS)
	})

	it('drops a parent span the unit covers entirely rather than keeping it at zero', () => {
		const resolved = time_overlap.resolve_delegated([span('Agent', 10, 10)], [span('Read', 10, 10)])

		expect(resolved.map((one) => one.label)).toStrictEqual(['Read'])
	})

	it('keeps every delegated span whole, because the unit is the detail', () => {
		const delegated = [span('Read', 4, 4), span('Edit', 6, 2)]
		const resolved = time_overlap.resolve_delegated([span('Agent', 10, 10)], delegated)

		expect(resolved.filter((one) => one.label !== 'Agent')).toStrictEqual(delegated)
	})
})

// Where what is left of a parent span sits on the timeline. Shrinking a duration and keeping the
// span's own end is not enough: `window_of` reads a span's start as `ended_ms - duration_ms`, and
// the CI wait is the part of the merge window no span covers, so a remainder placed at the wrong
// minute moves both.
describe('time_overlap.resolve_delegated — where the remainder sits', () => {
	// The brief written before the call and the result read after it are both the parent's own work,
	// and the unit's window lies between them.
	it('returns each uncovered part of the parent wait at its own instants', () => {
		const resolved = time_overlap.resolve_delegated([span('Agent', 10, 10)], [span('Read', 8, 6)])
		const parts = resolved.filter((one) => one.label === 'Agent')

		expect(parts.map((one) => [one.ended_ms, one.duration_ms])).toStrictEqual([
			[2 * MINUTE_MS, 2 * MINUTE_MS],
			[10 * MINUTE_MS, 2 * MINUTE_MS],
		])
	})

	// A cover reaching the span's end leaves the remainder at the front. Keeping the span's own end
	// would report those eight minutes as having happened last rather than first.
	it('places a remainder that precedes the cover before it, not at the tail', () => {
		const resolved = time_overlap.resolve_delegated([span('Agent', 10, 10)], [span('Read', 10, 2)])
		const parent_span = resolved.find((one) => one.label === 'Agent')

		expect(parent_span?.ended_ms).toBe(8 * MINUTE_MS)
		expect(parent_span?.duration_ms).toBe(8 * MINUTE_MS)
	})
})
