import { describe, expect, it } from 'vitest'
import { time_format } from './time-format'
import { time_phase_table } from './time-phase-table'
import { time_phases, type PhaseName, type PhaseTotal } from './time-phases'
import { time_report } from './time-report'
import { time_report_fixture } from './time-report-fixture'

// joshuafolkken/kit#1392: the `ci` row is withheld while its minutes stay inside `elapsed_ms`, so the
// shares printed above it no longer add up and nothing in the table accounts for the difference.
//
// The rows are built as `PhaseTotal` records rather than measured from a transcript, because that is
// the whole of this module's input — a suite that assembled a run to reach them would be testing
// `time-phases.ts` a second time.

const MINUTE_MS = 60_000
const ELAPSED_MS = 25 * MINUTE_MS
const WITHHELD_MS = 5 * MINUTE_MS
const MERGE_MS = 20 * MINUTE_MS

function detected(phase: PhaseName, duration_ms: number): PhaseTotal {
	return { phase, duration_ms, is_detected: true }
}

function withheld(phase: PhaseName, duration_ms: number): PhaseTotal {
	return { phase, duration_ms, is_detected: false }
}

// The state the issue is about: the cycles could not be read, so `ci` prints no figure while its five
// minutes stay in the denominator the `merge` share was taken against.
const UNREAD_CYCLES: ReadonlyArray<PhaseTotal> = [
	withheld(time_phases.CI_PHASE, WITHHELD_MS),
	detected(time_phases.MERGE_PHASE, MERGE_MS),
]

function rendered(phases: ReadonlyArray<PhaseTotal>): string {
	return time_phase_table.phase_lines(phases, ELAPSED_MS).join('\n')
}

function withheld_line(phases: ReadonlyArray<PhaseTotal>): string {
	return (
		rendered(phases)
			.split('\n')
			.find((line) => line.includes(time_phase_table.WITHHELD_LABEL)) ?? ''
	)
}

describe('time_phase_table.phase_lines — the rows', () => {
	it('prints the phases under their own heading', () => {
		expect(rendered(UNREAD_CYCLES)).toContain(time_phase_table.HEADING)
	})

	// A measured zero would assert that the phase did not run, which is the one thing a reading that
	// failed cannot say.
	it('withholds a phase whose marker never appeared instead of printing a zero', () => {
		const line = time_format.format_columns(time_phases.CI_PHASE, '', time_phase_table.NOT_DETECTED)

		expect(rendered(UNREAD_CYCLES)).toContain(line)
	})

	it('says nothing at all where there are no phases', () => {
		expect(time_phase_table.phase_lines([], ELAPSED_MS)).toEqual([])
	})
})

describe('time_phase_table.phase_lines — what the rows do not show', () => {
	// The regression: without this line the table prints `merge 80.0%` and nothing else, so the column
	// is 20 points short of the elapsed time it was taken against with no way to read why.
	it('accounts for the minutes the withheld row leaves out of the column', () => {
		expect(withheld_line(UNREAD_CYCLES)).toContain('5.0 min')
	})

	// Both halves are read off the *same* rendering, so the pair fails if either the row or the
	// footnote is taken against a denominator the other was not.
	it('gives those minutes the share that squares the column with the elapsed time', () => {
		expect(rendered(UNREAD_CYCLES)).toContain(
			time_format.format_row(time_phases.MERGE_PHASE, MERGE_MS, '80.0%'),
		)
		expect(withheld_line(UNREAD_CYCLES)).toContain('20.0%')
	})

	// A reader who can see that five minutes are missing still cannot act on it without knowing which
	// reading was withheld — which is what `time-run.ts`'s cycle note is then read against.
	it('names the withheld phase the minutes belong to', () => {
		expect(withheld_line(UNREAD_CYCLES)).toContain(time_phases.CI_PHASE)
	})

	it('says the minutes are still inside the total the shares were taken against', () => {
		expect(withheld_line(UNREAD_CYCLES)).toContain(time_phase_table.WITHHELD_NOTE)
	})

	// A table that already adds up needs no footnote, and printing one there would suggest a gap that
	// is not in it.
	it('prints nothing where every row was detected', () => {
		const whole = [detected(time_phases.MERGE_PHASE, ELAPSED_MS)]

		expect(rendered(whole)).not.toContain(time_phase_table.WITHHELD_LABEL)
	})

	// The common withheld phase is a window whose boundary was never found, which collects no span
	// either — so a footnote naming it would report a `0.0 min` difference, the confident zero the
	// withholding exists to prevent.
	it('leaves out a withheld row that takes no minutes out of the column', () => {
		const empty = [withheld(time_phases.PLAN_PHASE, 0), detected(time_phases.MERGE_PHASE, MERGE_MS)]

		expect(rendered(empty)).not.toContain(time_phase_table.WITHHELD_LABEL)
	})
})

const { MIXED, line_of, run_report, run_report_of } = time_report_fixture

// The same table end to end, which is the state joshuafolkken/kit#1392 was filed from: the cycles
// could not be read, so `time-phases.ts` withholds the row while `categories.ci_ms` keeps its five
// minutes inside `elapsed_ms`. Neither half is visible to the suite above, which is handed its rows
// already built.
const UNREAD_CI = { ci_ms: WITHHELD_MS, has_ci_data: true, windows: [], has_windows: false }

function unread_report(): string {
	return time_report.format_report(run_report_of(MIXED, UNREAD_CI))
}

describe('time_report.format_report — a run whose CI cycles could not be read', () => {
	it('withholds the ci row rather than printing a zero for it', () => {
		expect(unread_report()).toContain(
			time_format.format_columns(time_phases.CI_PHASE, '', time_phase_table.NOT_DETECTED),
		)
	})

	// The regression: the row carries no figure while its minutes stay in the denominator, so without
	// the footnote the printed shares fall 20 points short with nothing saying what accounts for it.
	it('accounts in the table for the minutes that row leaves out of the column', () => {
		const line = line_of(unread_report(), time_phase_table.WITHHELD_LABEL)

		expect(line).toContain('5.0 min')
		expect(line).toContain('20.0%')
		expect(line).toContain(time_phases.CI_PHASE)
	})

	// The same run with the cycles read prints the `ci` row itself, so nothing is missing from the
	// column and there is no footnote to print.
	it('prints no such line where the cycles were read', () => {
		const text = time_report.format_report(run_report(MIXED, WITHHELD_MS))

		expect(text).not.toContain(time_phase_table.WITHHELD_LABEL)
	})
})
