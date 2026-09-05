import { describe, expect, it } from 'vitest'
import { time_phases } from './time-phases'
import type { TimeReport } from './time-report'
import { time_run_fixture, type GhScript } from './time-run-fixture'
import { time_transcript_fixture as fixture } from './time-transcript-fixture'

// joshuafolkken/kit#1384, end to end: PR #1380's second CI cycle ran with the run doing nothing but
// waiting for it inside `josh followup`, and `josh time` charged those seconds to `merge` while
// printing `ci` as zero — which had `diag` rank the issue that would have cut them last, as work with
// no wall clock behind it.
//
// The scripted `gh` and the temporary transcript home are `time-run-fixture.ts`'s, shared with
// `time-run.test.ts`: what GitHub answered is one statement, not one per suite.

const { MINUTE_MS, BRANCH, issue_lines } = fixture
const { SHA, write_session, merged_pull, report_of, checks_body } = time_run_fixture

time_run_fixture.use_transcript_home()

const MERGE_CALL_ID = 'merge-1'
const UNIT = 'unit'
const UNREAD_MARK = 'the CI cycles could not be read'
const HEAD_COMMIT = `[{"sha":"${SHA}"}]`

// The run sits in `josh followup` from minute 4 to minute 8; the cycle it pushed runs 5 → 7, so the
// whole of that cycle is wall clock nothing but the merge command was sitting on.
function merging_lines(): Array<string> {
	return [
		...issue_lines(0),
		fixture.josh_call_line(4, BRANCH, 'pnpm josh followup --merge', MERGE_CALL_ID),
		fixture.result_line(8, BRANCH, MERGE_CALL_ID),
	]
}

const SERIAL_SCRIPT: GhScript = {
	pull_body: merged_pull(2, 8),
	commits_body: HEAD_COMMIT,
	checks_body: checks_body(UNIT, 5, 7),
}

function phase_ms(report: TimeReport, phase: string): number {
	return report.phases.find((total) => total.phase === phase)?.duration_ms ?? 0
}

describe('time_run.build_run_report — a serialized CI cycle', () => {
	it('charges the cycle the merge command waited on to the ci phase', async () => {
		write_session('one', merging_lines())

		const report = await report_of(SERIAL_SCRIPT)

		expect(phase_ms(report, time_phases.CI_PHASE)).toBe(2 * MINUTE_MS)
	})

	it('takes the same minutes off the merge phase rather than counting them twice', async () => {
		write_session('one', merging_lines())

		const report = await report_of(SERIAL_SCRIPT)

		expect(phase_ms(report, time_phases.MERGE_PHASE)).toBe(2 * MINUTE_MS)
	})

	// The `CI wait` category is still the part of the window no span covers, so the two figures differ
	// on a run that watched its own merge. A reader takes that for a contradiction unless it is said.
	it('says in a note where the merge command was waiting on CI', async () => {
		write_session('one', merging_lines())

		const report = await report_of(SERIAL_SCRIPT)

		expect(report.categories.ci_ms).toBe(0)
		expect(report.notes.some((note) => note.includes('waiting on CI'))).toBe(true)
	})
})

// The issue's fourth acceptance criterion: a listing nobody got an answer from is reported as
// unmeasured, not as a run that waited no time at all.
describe('time_run.build_run_report — CI cycles that could not be read', () => {
	it('reports the ci phase as undetected where the commit listing could not be read', async () => {
		write_session('one', merging_lines())

		const report = await report_of({ ...SERIAL_SCRIPT, is_commits_refused: true })
		const ci = report.phases.find((total) => total.phase === time_phases.CI_PHASE)

		expect(ci?.is_detected).toBe(false)
	})

	// Nothing is reattributed on an unmeasured reading, so the merge phase keeps its whole span rather
	// than losing minutes to a figure the report is not printing.
	it('leaves the merge phase whole where the cycles are unmeasured', async () => {
		write_session('one', merging_lines())

		const report = await report_of({ ...SERIAL_SCRIPT, is_commits_refused: true })

		expect(phase_ms(report, time_phases.MERGE_PHASE)).toBe(4 * MINUTE_MS)
	})
})

// The gap the withheld row would otherwise leave: `ci` says `not detected` while the `CI wait` share
// beside it is a real measurement, so something has to say which of the two was withheld and why.
describe('time_run.build_run_report — the withheld cycle note', () => {
	it('says the cycles could not be read where the ci phase is withheld', async () => {
		write_session('one', merging_lines())

		const report = await report_of({ ...SERIAL_SCRIPT, is_commits_refused: true })

		expect(report.notes.some((note) => note.includes(UNREAD_MARK))).toBe(true)
	})

	it('says nothing where the cycles were read', async () => {
		write_session('one', merging_lines())

		const report = await report_of(SERIAL_SCRIPT)

		expect(report.notes.some((note) => note.includes(UNREAD_MARK))).toBe(false)
	})
})
