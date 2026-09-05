import { describe, expect, it } from 'vitest'
import { time_format } from './time-format'
import { time_markers } from './time-markers'
import { time_phase_fixture } from './time-phase-fixture'
import { time_single_checks, type SingleCheckTotals } from './time-single-checks'
import { time_spans, type Span } from './time-spans'

// How much of a run went on re-verifying file by file between edits (joshuafolkken/kit#1383).
//
// The cases are about the one distinction the block rests on: a check run again **after an edit** is
// feedback and is counted only as a call, while a check run again over a tree nothing has touched is
// a question whose answer the run already had. Reading the second as the first reports the waste as
// zero; reading the first as the second reports ordinary feedback as waste, which is worse.

const { span, waited } = time_phase_fixture
const LINT = 'josh lint:related'
const KEY = 'josh lint:related a.ts'
const OTHER_KEY = 'josh lint:related b.ts'
const GATE = 'josh gate'
const PNPM_LABEL = 'Bash: pnpm'
// A price large enough that the round trip changes the printed minute: at a couple of seconds the
// saving rounds to the execution alone, and the case would pass without the trip being added at all.
const PRICE = { round_trip_count: 4, model_ms_per_round_trip: 30_000 }

function check(start_minute: number, key: string = KEY): Span {
	return span(start_minute, 1, { check_key: key, josh_command: LINT, label: PNPM_LABEL })
}

function thinking(start_minute: number): Span {
	return span(start_minute, 1, { category: time_spans.MODEL_CATEGORY })
}

function edited(start_minute: number): Span {
	return span(start_minute, 1, { marker: time_markers.EDIT_MARKER, label: 'Edit' })
}

function totals_of(spans: ReadonlyArray<Span>): SingleCheckTotals {
	return time_single_checks.build_single_checks(spans)
}

function line_of(lines: ReadonlyArray<string>, label: string): string {
	return lines.find((row) => row.includes(label)) ?? ''
}

describe('build_single_checks — counting the calls', () => {
	it('counts every single check the run issued', () => {
		const totals = totals_of([thinking(0), check(1), thinking(2), check(3, OTHER_KEY)])

		expect(totals.call_count).toBe(2)
	})

	it('counts a repeat of the same command and arguments', () => {
		const totals = totals_of([thinking(0), check(1), thinking(2), check(3)])

		expect(totals.repeat_count).toBe(1)
	})

	it('does not count a call with different arguments as a repeat', () => {
		const totals = totals_of([thinking(0), check(1), thinking(2), check(3, OTHER_KEY)])

		expect(totals.repeat_count).toBe(0)
	})

	// A tail is the remainder of a call whose middle went to a delegated unit, and counting it would
	// report the run as having checked twice when it checked once — the double count every other block
	// in this report already refuses.
	it('does not count the continuation of one call as a second call', () => {
		const tail = { ...check(3), is_continuation: true }
		const totals = totals_of([thinking(0), check(1), tail])

		expect(totals.call_count).toBe(1)
	})
})

describe('build_single_checks — what answered nothing new', () => {
	it('counts a repeat that only a model turn sat between', () => {
		const totals = totals_of([thinking(0), check(1), thinking(2), check(3)])

		expect(totals.unchanged_count).toBe(1)
	})

	it('carries the wall clock that repeat cost', () => {
		const totals = totals_of([thinking(0), check(1), thinking(2), check(3)])

		expect(totals.unchanged_ms).toBe(time_phase_fixture.MINUTE_MS)
	})

	it('does not count a repeat with an edit between the two calls', () => {
		const totals = totals_of([thinking(0), check(1), edited(2), check(3)])

		expect(totals.unchanged_count).toBe(0)
	})

	// The conservative half of the rule, asserted so it cannot be loosened by accident: nothing here
	// can prove a person left the tree alone, so a repeat across a typed prompt is not counted.
	it('does not count a repeat with a person waited on between the two calls', () => {
		const totals = totals_of([thinking(0), check(1), waited(2, 1), check(3)])

		expect(totals.unchanged_count).toBe(0)
	})

	it('counts the third call of a run that edited only once', () => {
		const totals = totals_of([check(0), edited(1), check(2), thinking(3), check(4)])

		expect(totals.unchanged_count).toBe(1)
	})

	// The tail of a call already counted at its head is the same call, not a new event: letting it
	// clear the set would silently drop the repeat that follows it.
	it('keeps the answer across the tail of a check call', () => {
		const tail = { ...check(2), is_continuation: true }
		const totals = totals_of([check(0), thinking(1), tail, thinking(3), check(4)])

		expect(totals.unchanged_count).toBe(1)
	})
})

// A call issued beside another is one the run stopped for anyway, so removing it leaves the stop
// where it was — pricing it would promise back model time no change removes, the over-report this
// block leans away from everywhere else.
describe('build_single_checks — the round trips a repeat cost', () => {
	const batched: ReadonlyArray<Span> = [
		check(0),
		check(1, OTHER_KEY),
		thinking(2),
		check(3),
		check(4, OTHER_KEY),
	]

	it('counts both calls of a batched turn as repeats that answered nothing new', () => {
		expect(totals_of(batched).unchanged_count).toBe(2)
	})

	it('bills neither of them a round trip, since removing either leaves the stop', () => {
		expect(totals_of(batched).unchanged_trip_count).toBe(0)
	})

	it('bills a repeat that was the only call in its turn', () => {
		const alone = totals_of([thinking(0), check(1), thinking(2), check(3)])

		expect(alone.unchanged_trip_count).toBe(1)
	})
})

// The fix phase is the window from the first gate to the pull request, which is the stretch the issue
// was filed from — so the count has to say how many of the calls sat inside it rather than only how
// many the whole run made.
describe('build_single_checks — the fix phase', () => {
	const run: ReadonlyArray<Span> = [
		check(0),
		edited(1),
		span(2, 1, { josh_command: GATE, label: PNPM_LABEL }),
		check(3),
	]

	it('counts the calls that sat in the rework phase', () => {
		expect(totals_of(run).rework_call_count).toBe(1)
	})

	it('leaves the calls before implementation out of that count', () => {
		expect(totals_of(run).call_count).toBe(2)
	})
})

describe('single_check_lines', () => {
	const totals = totals_of([thinking(0), check(1), thinking(2), check(3)])
	const lines = time_single_checks.single_check_lines(totals, PRICE)

	it('prints the heading', () => {
		expect(lines).toContain(time_single_checks.HEADING)
	})

	it('says what makes two calls the same', () => {
		expect(line_of(lines, time_single_checks.REPEAT_LABEL)).toContain(
			time_single_checks.REPEAT_NOTE,
		)
	})

	it('says why the repeat could not have answered differently', () => {
		expect(line_of(lines, time_single_checks.UNCHANGED_LABEL)).toContain(
			time_single_checks.UNCHANGED_NOTE,
		)
	})

	// One minute of execution plus the model wait of the round trip it occupied.
	it('prices the recoverable time at the execution plus its round trip', () => {
		const saved = time_phase_fixture.MINUTE_MS + PRICE.model_ms_per_round_trip

		expect(line_of(lines, time_single_checks.SAVING_LABEL)).toContain(
			time_format.format_minutes(saved),
		)
	})
})

describe('single_check_lines — what is withheld', () => {
	it('withholds every row when no span was read', () => {
		const lines = time_single_checks.single_check_lines(time_single_checks.NO_SINGLE_CHECKS, PRICE)

		expect(line_of(lines, time_single_checks.CALLS_LABEL)).toContain(time_format.NOT_MEASURED)
	})

	// The counts are measurements even here — a transcript that was read and issued no call really did
	// issue no single check — so only the row that needs a divisor is withheld.
	it('keeps the counts and withholds only the price when there was no round trip', () => {
		const totals = totals_of([thinking(0), check(1)])
		const lines = time_single_checks.single_check_lines(totals, {
			round_trip_count: 0,
			model_ms_per_round_trip: 0,
		})

		expect(line_of(lines, time_single_checks.CALLS_LABEL)).not.toContain(time_format.NOT_MEASURED)
		expect(line_of(lines, time_single_checks.SAVING_LABEL)).toContain(time_format.NO_CALLS)
	})
})
