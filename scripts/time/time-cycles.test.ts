import { describe, expect, it } from 'vitest'
import { time_ci, type CiFacts } from './time-ci'
import { time_cycles } from './time-cycles'
import type { Interval } from './time-overlap'
import { time_phase_fixture } from './time-phase-fixture'
import { time_report } from './time-report'
import { time_report_fixture } from './time-report-fixture'
import type { Span } from './time-spans'

const { MERGE_COMMAND, GATE_COMMAND, span } = time_phase_fixture
const { line_of, run_report_of } = time_report_fixture

const SECOND_MS = 1000
const SECONDS_PER_MINUTE = 60

// Run #1441, with 00:37:00 as the origin (joshuafolkken/kit#1465). Two cycles of nearly the same
// length that cost opposite amounts: the first ran wholly behind the second review round, the second
// with nothing else running at all.
const FIRST_CYCLE_START_S = 9
const FIRST_CYCLE_LENGTH_S = 109
const SECOND_CYCLE_START_S = 463
const SECOND_CYCLE_LENGTH_S = 103
const GATE_LENGTH_S = 24
const REVIEW_START_S = 24
const REVIEW_LENGTH_S = 367
const MERGE_START_S = 400
const MERGE_LENGTH_S = 200

const REVIEW_LABEL = 'Skill'
const GATE_LABEL = 'Bash'
const NAKED_SECOND_CYCLE = 'naked 103.0 s'

function at(start_s: number, length_s: number, extra: Partial<Span> = {}): Span {
	return span(start_s / SECONDS_PER_MINUTE, length_s / SECONDS_PER_MINUTE, extra)
}

function window(start_s: number, length_s: number): Interval {
	return { started_ms: start_s * SECOND_MS, ended_ms: (start_s + length_s) * SECOND_MS }
}

// The commit that opened the pull request and the review that ran beside its checks, then the merge
// command sitting on the second cycle with nothing beside it.
const SPANS: ReadonlyArray<Span> = [
	at(0, GATE_LENGTH_S, { josh_command: GATE_COMMAND, label: GATE_LABEL }),
	at(REVIEW_START_S, REVIEW_LENGTH_S, { label: REVIEW_LABEL }),
	at(MERGE_START_S, MERGE_LENGTH_S, { josh_command: MERGE_COMMAND, label: GATE_LABEL }),
]

const WINDOWS: ReadonlyArray<Interval> = [
	window(FIRST_CYCLE_START_S, FIRST_CYCLE_LENGTH_S),
	window(SECOND_CYCLE_START_S, SECOND_CYCLE_LENGTH_S),
]

function facts(windows: ReadonlyArray<Interval>, has_windows = true): CiFacts {
	return { ci_ms: 0, has_ci_data: true, windows, has_windows }
}

function lines(ci: CiFacts): Array<string> {
	return time_cycles.cycle_lines(time_cycles.build_cycles(SPANS, ci))
}

describe('time_cycles.build_cycles — run #1441', () => {
	it('reports one cycle per check window, in run order', () => {
		const totals = time_cycles.build_cycles(SPANS, facts(WINDOWS))

		expect(totals.cycles.map((cycle) => cycle.duration_ms)).toEqual([
			FIRST_CYCLE_LENGTH_S * SECOND_MS,
			SECOND_CYCLE_LENGTH_S * SECOND_MS,
		])
	})

	it('carries the start and end of each cycle', () => {
		const [first] = time_cycles.build_cycles(SPANS, facts(WINDOWS)).cycles

		expect(first?.started_ms).toBe(FIRST_CYCLE_START_S * SECOND_MS)
		expect(first?.ended_ms).toBe((FIRST_CYCLE_START_S + FIRST_CYCLE_LENGTH_S) * SECOND_MS)
	})

	it('reads the hidden cycle as no wall clock and the naked one as its whole length', () => {
		const totals = time_cycles.build_cycles(SPANS, facts(WINDOWS))

		expect(totals.cycles.map((cycle) => cycle.naked_ms)).toEqual([
			0,
			SECOND_CYCLE_LENGTH_S * SECOND_MS,
		])
	})

	it('names the busiest command the hidden cycle ran behind', () => {
		const [first, second] = time_cycles.build_cycles(SPANS, facts(WINDOWS)).cycles

		expect(first?.lead_label).toBe(REVIEW_LABEL)
		expect(second?.lead_label).toBe('')
	})

	it('leaves the merge command out of what a cycle can hide behind', () => {
		const [, second] = time_cycles.build_cycles(SPANS, facts(WINDOWS)).cycles

		expect(second?.lead_phase).toBe('')
	})

	it('counts a window shared by two commits once', () => {
		const shared = [window(SECOND_CYCLE_START_S, SECOND_CYCLE_LENGTH_S), ...WINDOWS]
		const totals = time_cycles.build_cycles(SPANS, facts(shared))

		expect(totals.cycles).toHaveLength(WINDOWS.length)
	})
})

describe('time_cycles.build_cycles — the withheld answers', () => {
	it('reports unread check-runs as unmeasured rather than as no cycle', () => {
		const totals = time_cycles.build_cycles(SPANS, facts([], false))

		expect(totals.is_measured).toBe(false)
		expect(totals.has_pull).toBe(true)
	})

	it('withholds the whole block for a scope with no pull request', () => {
		expect(time_cycles.build_cycles(SPANS, time_ci.NO_CI).has_pull).toBe(false)
	})

	it('reports a scope with no transcript as unmeasured rather than as wholly naked', () => {
		const totals = time_cycles.build_cycles([], facts(WINDOWS))

		expect(totals.is_measured).toBe(false)
		expect(totals.cycles).toEqual([])
	})

	it('separates a pull request that ran no check from one that could not be read', () => {
		const totals = time_cycles.build_cycles(SPANS, facts([]))

		expect(totals.is_measured).toBe(true)
		expect(totals.cycles).toEqual([])
	})
})

describe('time_cycles.cycle_lines', () => {
	it('prints the naked seconds of each cycle', () => {
		expect(lines(facts(WINDOWS)).join('\n')).toContain(NAKED_SECOND_CYCLE)
	})

	it('names what the hidden cycle ran behind', () => {
		const text = lines(facts(WINDOWS)).join('\n')

		expect(text).toContain('naked 0.0 s')
		expect(text).toContain(`behind`)
		expect(text).toContain(REVIEW_LABEL)
	})

	it('says nothing about what a naked cycle hid behind', () => {
		const [, second] = lines(facts(WINDOWS)).slice(2)

		expect(second).not.toContain('behind')
	})

	it('prints the withheld row when the check-runs could not be read', () => {
		expect(lines(facts([], false)).join('\n')).toContain(time_report.NOT_MEASURED)
	})

	it('prints no cycle count for a scope with no pull request', () => {
		expect(lines(time_ci.NO_CI)).toEqual([])
	})

	it('says so when a pull request ran no check at all', () => {
		expect(lines(facts([])).join('\n')).toContain(time_cycles.NO_CYCLE)
	})
})

describe('time_report.format_report — CI cycles', () => {
	it('carries the block on a run report that read its check windows', () => {
		const text = time_report.format_report(run_report_of(SPANS, facts(WINDOWS)))

		expect(text).toContain(time_cycles.HEADING)
		expect(line_of(text, NAKED_SECOND_CYCLE)).toContain('1.7 min')
	})

	it('prints the withheld row rather than an empty block when the check-runs were unread', () => {
		const text = time_report.format_report(run_report_of(SPANS, facts([], false)))

		const withheld = time_report.unmeasured_row(time_cycles.CYCLE_LABEL)

		expect(text).toContain(`${time_cycles.HEADING}\n${withheld}`)
	})

	it('leaves the block out of a scope with no pull request', () => {
		const text = time_report.format_report(run_report_of(SPANS, time_ci.NO_CI))

		expect(text).not.toContain(time_cycles.HEADING)
	})
})
