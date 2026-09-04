import { describe, expect, it } from 'vitest'
import { time_batch, type RunTiming } from './time-batch'
import { time_distribution } from './time-distribution'
import { time_epic_fixture } from './time-epic-fixture'
import { time_format } from './time-format'
import type { LastTimeReport } from './time-last'
import { time_last_report } from './time-last-report'

// What a set of runs is read as (joshuafolkken/kit#1312).

const { MINUTE_MS, report_of } = time_epic_fixture

const FIRST = 201
const SECOND = 202
const GATE = 'gate'
const EXCLUSION_NOTE =
	'1 run(s) merged with no session transcript attributed, so only their CI wait is known — they are excluded from the elapsed and transcript-side rows as unmeasured rather than counted as zero'

function timing(issue_number: number, span_count: number): RunTiming {
	return time_batch.to_timing(issue_number, report_of({ issue_number, span_count }))
}

function report_with(overrides: Partial<LastTimeReport>): LastTimeReport {
	return {
		scope: 'the last 2 merged run(s)',
		requested_count: 2,
		runs: [timing(FIRST, 2), timing(SECOND, 0)],
		measured_count: 1,
		unmeasured_count: 1,
		elapsed: time_distribution.build([2 * MINUTE_MS]),
		categories: [],
		phases: [],
		checks: [],
		notes: [EXCLUSION_NOTE],
		...overrides,
	}
}

function lines_of(report: LastTimeReport): Array<string> {
	return time_last_report.format_last_report(report).split('\n')
}

function line_with(report: LastTimeReport, needle: string): string {
	return lines_of(report).find((line) => line.includes(needle)) ?? ''
}

describe('time_last_report.format_last_report — a measured row', () => {
	const measured = report_with({
		phases: [time_distribution.labeled(GATE, [MINUTE_MS, 3 * MINUTE_MS, 5 * MINUTE_MS])],
	})

	// The median goes in the numeric column so a reader scanning it is scanning one comparable figure
	// per row; the range and the sample count qualify it.
	it('puts the median in the duration column and the range beside it', () => {
		const line = line_with(measured, GATE)

		expect(line).toContain('3.0 min')
		expect(line).toContain('1.0 min – 5.0 min')
		expect(line).toContain('3 run(s)')
	})

	it('prints the phase heading above it', () => {
		expect(lines_of(measured)).toContain(time_last_report.PHASE_HEADING)
	})
})

describe('time_last_report.format_last_report — a row nobody could sample', () => {
	const unsampled = report_with({ phases: [time_distribution.labeled(GATE, [])] })

	// The acceptance criterion at the level of one line: a phase no run detected is withheld, never a
	// measured zero.
	it('says "not measured" rather than printing a zero', () => {
		const line = line_with(unsampled, GATE)

		expect(line).toContain(time_format.NOT_MEASURED)
		expect(line).not.toContain('0.0 min')
	})
})

describe('time_last_report.format_last_report — the runs it was read from', () => {
	const report = report_with({})

	// A distribution whose sample nobody can name is not one a reader can check.
	it('lists each run with the state it was measured in', () => {
		expect(line_with(report, `#${String(FIRST)}`)).toContain(time_batch.MEASURED)
		expect(line_with(report, `#${String(SECOND)}`)).toContain(time_batch.NO_TRANSCRIPT)
	})

	it('leaves the duration column empty for a run nothing could be measured for', () => {
		const never_run = report_with({
			runs: [
				time_batch.to_timing(
					FIRST,
					report_of({ issue_number: FIRST, span_count: 0, has_ci_data: false }),
				),
			],
		})

		expect(line_with(never_run, `#${String(FIRST)}`)).not.toContain('min')
	})

	it('carries the exclusion note under the heading', () => {
		expect(line_with(report, 'excluded')).toContain(EXCLUSION_NOTE)
	})

	it('says how many of the runs were fully measured', () => {
		expect(lines_of(report)[0]).toContain('1 of 2 fully measured')
	})
})
