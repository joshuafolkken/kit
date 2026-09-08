import { describe, expect, it } from 'vitest'
import { time_report } from './time-report'
import { time_run_fixture, type GhScript } from './time-run-fixture'
import { time_transcript_fixture as fixture } from './time-transcript-fixture'
import { time_windows } from './time-windows'

// joshuafolkken/kit#1409: a run scope reports three nested windows, and each of them is read or
// withheld on its own. A suite of its own rather than another block in `time-run.test.ts`, which sits
// near its length limit — the same split `time-row-cap.test.ts` already made.

const { MINUTE_MS, ms, issue_lines } = fixture
const { write_session, report_of, merged_pull, open_pull, closed_issue, open_issue } =
	time_run_fixture

time_run_fixture.use_transcript_home()

// The run every case shares: a pull request opened at minute 2 and merged at minute 8, inside an
// issue filed at minute 0 and closed at minute 9.
const FULL_SCRIPT: GhScript = { pull_body: merged_pull(2, 8), issue_body: closed_issue(0, 9) }

describe('time_run.build_run_report — the three nested windows', () => {
	it('reports the run, the pull request and the issue as three windows', async () => {
		write_session('one', issue_lines(0))

		const { windows } = await report_of(FULL_SCRIPT)

		// The transcript covers minutes 0 to 3, and the run body is the transcript's alone — the pull
		// request's own 2→8 window is the row beneath it, not part of this one.
		expect(windows.run.elapsed_ms).toBe(3 * MINUTE_MS)
		expect(windows.pull.elapsed_ms).toBe(6 * MINUTE_MS)
		expect(windows.issue.elapsed_ms).toBe(9 * MINUTE_MS)
	})

	it('dates the pull request window from the pull request itself', async () => {
		write_session('one', issue_lines(0))

		const { windows } = await report_of(FULL_SCRIPT)

		expect(windows.pull.started_at).toBe(new Date(ms(2)).toISOString())
		expect(windows.pull.ended_at).toBe(new Date(ms(8)).toISOString())
	})

	it('withholds the pull request window where no pull request exists', async () => {
		write_session('one', issue_lines(0))

		const { windows } = await report_of({ pull_body: '[]', issue_body: closed_issue(0, 9) })

		expect(windows.pull).toEqual(time_windows.UNREAD_WINDOW)
		expect(windows.issue.is_read).toBe(true)
	})

	it('withholds the pull request window while the pull request is still open', async () => {
		write_session('one', issue_lines(0))

		const { windows } = await report_of({ pull_body: open_pull(2), issue_body: closed_issue(0, 9) })

		expect(windows.pull.is_read).toBe(false)
	})
})

describe('time_run.build_run_report — a window nobody could read', () => {
	// The defect the run-body window was built wrong for: `window_of` folds the pull request's stamps
	// into the pair `started_at` / `ended_at` come from, so a run body taken from that pair printed the
	// pull request's own 8.2 minutes as a run nobody measured.
	it('withholds the run window when no transcript was attributed to the issue', async () => {
		const { windows } = await report_of(FULL_SCRIPT)

		expect(windows.run).toEqual(time_windows.UNREAD_WINDOW)
		expect(windows.pull.is_read).toBe(true)
	})

	it('withholds the run window rather than reading it as zero-length', async () => {
		const { windows } = await report_of({ pull_body: open_pull(2), issue_body: open_issue(0) })

		expect(windows.run.is_read).toBe(false)
		expect(windows.run.elapsed_ms).toBe(0)
	})

	it('withholds the issue window while the issue is still open', async () => {
		write_session('one', issue_lines(0))

		const { windows } = await report_of({ ...FULL_SCRIPT, issue_body: open_issue(0) })

		expect(windows.issue).toEqual(time_windows.UNREAD_WINDOW)
		expect(windows.run.is_read).toBe(true)
	})

	it('withholds the issue window when its read is refused', async () => {
		write_session('one', issue_lines(0))

		const { windows } = await report_of({ ...FULL_SCRIPT, is_issue_refused: true })

		expect(windows.issue.is_read).toBe(false)
	})

	it('prints the three windows in the report a person reads', async () => {
		write_session('one', issue_lines(0))

		const text = time_report.format_report(await report_of(FULL_SCRIPT))

		expect(text).toContain(time_windows.HEADING)
		expect(text).toContain(time_windows.RUN_LABEL)
		expect(text).toContain(time_windows.PULL_LABEL)
		expect(text).toContain(time_windows.ISSUE_LABEL)
	})
})
