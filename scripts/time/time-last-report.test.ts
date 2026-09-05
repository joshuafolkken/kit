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
// The two sentences a run carries for itself: why its report could not be built at all, and why its
// per-check table is empty (joshuafolkken/kit#1352).
const FAILURE_NOTE = `issue #${String(FIRST)} could not be measured: gh: not authenticated`
const CHECK_READ_NOTE = `the CI check list could not be read for issue #${String(FIRST)} — the per-check table is empty for that reason, not because there were no checks`

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
		collapsed_pulls: [],
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

describe('time_last_report.format_last_report — which tables are display-capped', () => {
	const OVER_CAP = time_format.MAX_ROWS + 1
	const rows = Array.from({ length: OVER_CAP }, (_, index) =>
		time_distribution.labeled(`row-${String(index)}`, [MINUTE_MS]),
	)

	function labels_in(report: LastTimeReport): Array<string> {
		return lines_of(report).filter((line) => line.includes('row-'))
	}

	// `--issue`'s own phase table prints whole, and `PHASE_ORDER` holds exactly 15 names — so a cap
	// here would drop a phase from one scope and not the other the moment a sixteenth is added.
	it('prints the phase table whole', () => {
		expect(labels_in(report_with({ phases: rows }))).toHaveLength(OVER_CAP)
	})

	// The check table is the one that grows with whatever CI is configured to run, so it takes the same
	// display cap and overflow note every other table in the command prints through.
	it('caps the check table and says how many it withheld', () => {
		const capped = report_with({ checks: rows })

		expect(labels_in(capped)).toHaveLength(time_format.MAX_ROWS)
		expect(line_with(capped, 'and 1 more')).toContain('--json carries every row')
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

// The notes `time-run.ts` writes per run reach this table too (joshuafolkken/kit#1352). Without them
// a run whose report failed to build printed `failed` and nothing saying how, and a refused check
// read left the check rows quietly short of a sample.
//
// `has_ci_data` is one of the two halves a status is decided from, so a fixture states it rather than
// letting the report contradict the status it claims: a failed report read no merge at all.
function noted(
	status: RunTiming['status'],
	notes: ReadonlyArray<string>,
	has_ci_data = true,
): LastTimeReport {
	const base = time_batch.to_timing(
		FIRST,
		report_of({ issue_number: FIRST, span_count: 0, has_ci_data }),
	)

	return report_with({
		runs: [{ ...base, status, report: { ...base.report, notes: [...notes] } }],
	})
}

describe('time_last_report.format_last_report — a run’s own notes', () => {
	it('prints the reason under a run whose report could not be built', () => {
		const failed = noted(time_batch.FAILED, [FAILURE_NOTE], false)

		expect(line_with(failed, FAILURE_NOTE)).toContain(FAILURE_NOTE)
	})

	// The merge was read, so the row stays measured — the note is the only sign the read was refused.
	it('prints the refused-check note under a fully measured run', () => {
		const refused = noted(time_batch.MEASURED, [CHECK_READ_NOTE])

		expect(line_with(refused, CHECK_READ_NOTE)).toContain(CHECK_READ_NOTE)
	})
})
