import { describe, expect, it } from 'vitest'
import { time_overlap } from './time-overlap'
import { time_transcript_fixture as fixture } from './time-transcript-fixture'

const { MINUTE_MS, span, total_span_ms: total_ms } = fixture

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

// One session running two units at the same time. Each unit's spans were kept whole while the
// parent's bracketing span was trimmed by both, so the shared wall clock was counted once per unit
// and the four shares exceeded the elapsed time (joshuafolkken/kit#1287). `epicrun` and `queue` run
// their children one at a time, so the shape arrives with concurrent delegation rather than today.
describe('time_overlap.resolve_delegated — units that overlap each other', () => {
	it('counts wall clock two concurrent units share once', () => {
		const resolved = time_overlap.resolve_delegated(
			[span('Agent', 10, 10)],
			[span('Read', 10, 10), span('Edit', 8, 6)],
		)

		expect(total_ms(resolved)).toBe(10 * MINUTE_MS)
	})

	// `Read` covers minutes 0→6 and `Edit` runs 4→10, so four minutes of `Edit` are its own.
	it('keeps the part of a later unit the earlier one does not cover', () => {
		const resolved = time_overlap.resolve_delegated([], [span('Read', 6, 6), span('Edit', 10, 6)])

		expect(resolved.map((one) => [one.label, one.duration_ms])).toStrictEqual([
			['Read', 6 * MINUTE_MS],
			['Edit', 4 * MINUTE_MS],
		])
	})

	// Which unit keeps a shared minute has no true answer, so the requirement is that the answer never
	// depends on the order the transcript directory happened to list the unit files in.
	it('does not depend on the order the unit transcripts were read in', () => {
		const units = [span('Read', 6, 6), span('Edit', 10, 6)]
		const forward = time_overlap.resolve_delegated([], units)

		expect(time_overlap.resolve_delegated([], units.toReversed())).toStrictEqual(forward)
	})

	// The guarantee joshuafolkken/kit#1285 fixed and this must not disturb: units that overlap nothing
	// come back out of the reconciliation exactly as they went in.
	it('leaves sequential units untouched', () => {
		const units = [span('Read', 4, 4), span('Edit', 6, 2)]

		expect(time_overlap.resolve_delegated([], units)).toStrictEqual(units)
	})

	// Two units with the very same interval leave the comparator no instant to separate them, and a
	// stable sort then makes the survivor whichever transcript file had the older mtime.
	it('keeps the same unit when two share an interval exactly', () => {
		const units = [span('Read', 6, 6), span('Edit', 6, 6)]
		const forward = time_overlap.resolve_delegated([], units)

		expect(time_overlap.resolve_delegated([], units.toReversed())).toStrictEqual(forward)
	})
})

// Two transcript lines really can share a millisecond, and a span of no duration is what that
// produces. It covers nothing and is covered by nothing, so it has to survive on both sides of the
// subtraction — and it must not cut anything in half.
describe('time_overlap.resolve_delegated — spans of no duration', () => {
	it('keeps a delegated span of no duration rather than trimming it away', () => {
		const resolved = time_overlap.resolve_delegated([], [span('Read', 4, 4), span('Edit', 2, 0)])

		expect(resolved.map((one) => one.label)).toContain('Edit')
	})

	// The parent half, which is the common one: without it a transcript's turn count would depend on
	// whether the session happened to have a `subagents/` directory.
	it('keeps a parent span of no duration when the session delegated', () => {
		const parent = [span('Mark', 5, 0), span('Bash: git', 9, 2)]
		const resolved = time_overlap.resolve_delegated(parent, [span('Read', 3, 3)])

		expect(resolved.map((one) => one.label)).toContain('Mark')
	})

	// The walk emits the gap in front of every interval it consumes, so an instant with no length
	// reports one parent tool call as two with the minutes still adding up.
	it('does not split the span that encloses a delegated instant in two', () => {
		const resolved = time_overlap.resolve_delegated([span('Agent', 10, 10)], [span('Mark', 5, 0)])

		expect(resolved.filter((one) => one.label === 'Agent')).toHaveLength(1)
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

// joshuafolkken/kit#1384: a pull request's CI windows are read per commit, and two commits pushed in
// quick succession can produce windows that overlap. Summing a per-window figure over those counts
// the shared minutes twice, which is the one arithmetic error the CI measurement can make alone.
describe('time_overlap.union_intervals', () => {
	it('folds overlapping and out-of-order intervals into one', () => {
		const union = time_overlap.union_intervals([
			{ started_ms: 4, ended_ms: 8 },
			{ started_ms: 2, ended_ms: 6 },
		])

		expect(union).toEqual([{ started_ms: 2, ended_ms: 8 }])
	})

	it('keeps intervals with a gap between them apart', () => {
		const union = time_overlap.union_intervals([
			{ started_ms: 0, ended_ms: 2 },
			{ started_ms: 5, ended_ms: 7 },
		])

		expect(union).toEqual([
			{ started_ms: 0, ended_ms: 2 },
			{ started_ms: 5, ended_ms: 7 },
		])
	})

	it('answers nothing for nothing', () => {
		expect(time_overlap.union_intervals([])).toEqual([])
	})
})

// The arithmetic the `ci` phase is reattributed with: how much of a CI window only the merge command
// was sitting on. Everything else the run was doing stays where it is, and the part nothing covered
// at all is already the category share, so both are subtracted out.
describe('time_overlap.covered_only_by_ms', () => {
	const WINDOW = [{ started_ms: 0, ended_ms: 10 }]

	it('counts the part only the intervals left out of the rest cover', () => {
		const all = [{ started_ms: 0, ended_ms: 10 }]
		const rest = [{ started_ms: 0, ended_ms: 4 }]

		expect(time_overlap.covered_only_by_ms(WINDOW, all, rest)).toBe(6)
	})

	it('counts nothing where the rest already covers the window', () => {
		const covers = [{ started_ms: 0, ended_ms: 10 }]

		expect(time_overlap.covered_only_by_ms(WINDOW, covers, covers)).toBe(0)
	})

	// The part nothing covers is the category share, which is added on its own. Counting it here as
	// well would report the same wall clock twice.
	it('leaves out the part nothing covers at all', () => {
		expect(time_overlap.covered_only_by_ms(WINDOW, [], [])).toBe(0)
	})

	it('counts two overlapping windows once', () => {
		const windows = [
			{ started_ms: 0, ended_ms: 6 },
			{ started_ms: 4, ended_ms: 10 },
		]
		const all = [{ started_ms: 0, ended_ms: 10 }]

		expect(time_overlap.covered_only_by_ms(windows, all, [])).toBe(10)
	})
})
