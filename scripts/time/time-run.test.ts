import { cost_transcript } from '#scripts/cost/cost-transcript'
import { describe, expect, it, vi } from 'vitest'
import { time_checks } from './time-checks'
import { time_corpus } from './time-corpus'
import { time_pull_fixture } from './time-pull-fixture'
import { time_pull_index } from './time-pull-index'
import { time_report } from './time-report'
import { time_run } from './time-run'
import { time_run_fixture, type GhScript } from './time-run-fixture'
import { time_transcript_fixture as fixture } from './time-transcript-fixture'

// The transcript fixtures are `time-transcript-fixture.ts`'s, shared with the suite that covers the
// walk itself: what a session file looks like is one statement, not one per suite. The scripted `gh`
// and the temporary transcript home are `time-run-fixture.ts`'s, shared with the CI-cycle suite that
// measures the same runs (joshuafolkken/kit#1384).
const { CWD, MINUTE_MS, ISSUE, THREE_MINUTES_MS, at, ms, issue_lines } = fixture
// Which reads count as the pull-request listing is `time-pull-fixture.ts`'s, shared with the suites
// that assert the same count on the walk itself.
const { pulls_asked } = time_pull_fixture
const { SHA, SUCCESS, GH_REFUSAL, write_session, write_unit, reader } = time_run_fixture
const { merged_pull, open_pull, report_of, check_run, checks_body } = time_run_fixture

time_run_fixture.use_transcript_home()

// The pull request every case below shares: opened at minute 2, merged at minute 8.
const MERGED_SCRIPT: GhScript = { pull_body: merged_pull(2, 8) }
const NO_PULL_SCRIPT: GhScript = { pull_body: '[]' }
const NOTE_SEPARATOR = '\n'

const SKIPPED = 'skipped'
const UNIT = 'unit'
const CODERABBIT = 'CodeRabbit'
const E2E = 'E2E'

// The pull request every case here merges at minute 8, so these three jobs sit on both sides of that
// merge: `unit` finishes right at it, `CodeRabbit` two minutes after it, and `E2E` never ran.
const SPANNING_CHECKS = JSON.stringify({
	check_runs: [
		check_run(UNIT, SUCCESS, 3, 8),
		check_run(CODERABBIT, SUCCESS, 4, 10),
		check_run(E2E, SKIPPED, 3, 3),
	],
})

describe('time_run.build_run_report — the four shares', () => {
	it('adds the merge tail no transcript records as the CI wait', async () => {
		write_session('one', issue_lines(0))

		const report = await report_of(MERGED_SCRIPT)

		// The transcript covers minutes 0 to 3, so of the pull request's 2→8 window five minutes are
		// the CI wait and one is already counted as tool execution.
		expect(report.categories.ci_ms).toBe(5 * MINUTE_MS)
		expect(report.elapsed_ms).toBe(8 * MINUTE_MS)
	})

	it('reconstructs the elapsed time from exactly the four shares', async () => {
		write_session('one', issue_lines(0))

		const { categories, elapsed_ms } = await report_of(MERGED_SCRIPT)
		const { model_ms, tool_ms, human_ms, ci_ms } = categories

		expect(model_ms + tool_ms + human_ms + ci_ms).toBe(elapsed_ms)
	})

	it('dates the window from the earlier of the two sources and the later of the two', async () => {
		write_session('one', issue_lines(0))

		const report = await report_of(MERGED_SCRIPT)

		expect(report.started_at).toBe(new Date(ms(0)).toISOString())
		expect(report.ended_at).toBe(new Date(ms(8)).toISOString())
	})
})

describe('time_run.build_run_report — the CI check table', () => {
	it('names each CI job with its own duration', async () => {
		write_session('one', issue_lines(0))

		const report = await report_of({ ...MERGED_SCRIPT, checks_body: checks_body(UNIT, 3, 7) })

		expect(report.by_check).toEqual([
			{
				label: UNIT,
				duration_ms: 4 * MINUTE_MS,
				conclusion: SUCCESS,
				merge_gap_ms: -MINUTE_MS,
			},
		])
	})

	// GitHub really does stamp a check as completed before it started — `Notify Auto Tag` on PR #1277
	// printed as `-0.0 min`. That is a clock artefact, and a reader takes a negative row for a figure.
	it('never prints a negative duration for a check whose clocks disagree', async () => {
		write_session('one', issue_lines(0))

		const report = await report_of({ ...MERGED_SCRIPT, checks_body: checks_body('notify', 7, 6) })

		expect(report.by_check[0]?.duration_ms).toBe(0)
	})
})

// joshuafolkken/kit#1352's second symptom: the merge was read, so the row stays measured and `ci_ms`
// stays right — the only visible difference is an empty per-check table, which reads as a run GitHub
// recorded no checks for.
describe('time_run.build_run_report — a check read that was refused', () => {
	it('says the check list could not be read rather than printing an empty table', async () => {
		write_session('one', issue_lines(0))

		const report = await report_of({ ...MERGED_SCRIPT, is_checks_refused: true })

		expect(report.by_check).toEqual([])
		expect(report.has_ci_data).toBe(true)
		expect(report.notes.some((note) => time_run.is_check_read_note(note))).toBe(true)
	})

	// The guarantee the note is not allowed to cost: a run whose checks really were empty says nothing.
	it('says nothing where the read succeeded and there were no checks', async () => {
		write_session('one', issue_lines(0))

		const report = await report_of({ ...MERGED_SCRIPT, checks_body: '{"check_runs":[]}' })

		expect(report.notes.some((note) => time_run.is_check_read_note(note))).toBe(false)
	})
})

// The Issue's own case, end to end: the merge instant this file already reads is what tells the three
// rows apart, and the report is where the two halves meet (joshuafolkken/kit#1310).
describe('time_run.build_run_report — a check set that spans the merge', () => {
	it('measures each check against the merge instant', async () => {
		write_session('one', issue_lines(0))

		const report = await report_of({ ...MERGED_SCRIPT, checks_body: SPANNING_CHECKS })
		const gaps = report.by_check.map((check) => [check.label, check.merge_gap_ms])

		expect(gaps).toEqual([
			[CODERABBIT, 2 * MINUTE_MS],
			[UNIT, 0],
			[E2E, -5 * MINUTE_MS],
		])
	})

	it('names the last check to finish before the merge rather than the longest one', async () => {
		write_session('one', issue_lines(0))

		const report = await report_of({ ...MERGED_SCRIPT, checks_body: SPANNING_CHECKS })
		const text = time_report.format_report(report)

		expect(text).toContain(`${time_checks.MERGE_WAIT_PREFIX} ${UNIT}`)
		expect(text).toContain(`success · finished 2.0 min ${time_checks.AFTER_MERGE_NOTE}`)
		expect(text).toContain(`skipped · ${time_checks.SKIPPED_NOTE}`)
	})
})

async function refuse(): Promise<string> {
	throw new Error(GH_REFUSAL)
}

// The category rows are indented and padded to a fixed width, so the row reads `  CI wait   …`
// while the note that mentions the phrase is prose — matching the row shape tells them apart.
const CI_ROW = '  CI wait  '

// A `CI wait 0.0 min` row printed directly beneath a note saying the CI wait is unknown is the
// measured zero standing in for an unknown that `has_ci_data` exists to prevent.
describe('time_run.build_run_report — the withheld CI row', () => {
	it('withholds it for a pull request that is open', async () => {
		write_session('one', issue_lines(0))

		const report = await report_of({ pull_body: open_pull(2) })

		expect(report.has_ci_data).toBe(false)
		expect(time_report.format_report(report)).not.toContain(CI_ROW)
	})

	it('withholds it where no pull request was found', async () => {
		write_session('one', issue_lines(0))

		const report = await report_of(NO_PULL_SCRIPT)

		expect(report.has_ci_data).toBe(false)
		expect(time_report.format_report(report)).not.toContain(CI_ROW)
	})

	it('prints it once a merge has actually been read', async () => {
		write_session('one', issue_lines(0))

		const report = await report_of(MERGED_SCRIPT)

		expect(report.has_ci_data).toBe(true)
		expect(time_report.format_report(report)).toContain(CI_ROW)
	})
})

// Never silent, never zero: each missing half is named and the other half is printed anyway.
describe('time_run.build_run_report — what is not known', () => {
	it('reports an unmerged pull request and still prints what is known', async () => {
		write_session('one', issue_lines(0))

		const report = await report_of({ pull_body: open_pull(2) })

		expect(report.notes.join(NOTE_SEPARATOR)).toContain('not merged')
		expect(report.categories.ci_ms).toBe(0)
		expect(report.categories.tool_ms).toBe(2 * MINUTE_MS)
	})

	it('reports an issue with no pull request at all', async () => {
		write_session('one', issue_lines(0))

		const report = await report_of(NO_PULL_SCRIPT)

		expect(report.notes.join(NOTE_SEPARATOR)).toContain('no pull request exists')
		expect(report.span_count).toBe(2)
	})

	// A read that failed says so, rather than being reported as proof the issue has no pull request.
	it('separates a failed listing read from a definite absence', async () => {
		write_session('one', issue_lines(0))

		const report = await time_run.build_run_report(ISSUE, CWD, refuse)

		expect(report.notes.join(NOTE_SEPARATOR)).toContain('could not be read')
	})
})

describe('time_run.build_run_report — a missing transcript half', () => {
	it('reports an issue with no transcript rather than an empty table', async () => {
		const report = await report_of(MERGED_SCRIPT)

		expect(report.notes.join(NOTE_SEPARATOR)).toContain('no session transcript')
		expect(report.categories.ci_ms).toBe(6 * MINUTE_MS)
	})

	// Neither half known is a real case — an issue number nobody worked on here and that opened no
	// pull request. There is no window at all then, and computing one from an empty set yields
	// `Infinity`, which `toISOString()` throws on.
	it('reports an issue with neither half rather than failing on an empty window', async () => {
		const report = await report_of(NO_PULL_SCRIPT)

		expect(report.started_at).toBe('')
		expect(report.elapsed_ms).toBe(0)
		expect(time_report.format_report(report)).toContain('no timed lines')
	})

	// Two sessions two hours apart leave real time that belonged to nobody. Counted as elapsed, the
	// run reads as two hours long; left unsaid, the shares do not match the window a reader can see.
	it('names the gap between sessions rather than charging it to the run', async () => {
		write_session('one', issue_lines(0))
		write_session('two', issue_lines(120))

		const report = await report_of(NO_PULL_SCRIPT)

		expect(report.elapsed_ms).toBe(6 * MINUTE_MS)
		expect(report.notes.join(NOTE_SEPARATOR)).toContain('belongs to nobody')
	})
})

// How many notes a run carries before either window note: one for the transcripts, one for the pull
// request. Named so the case that asserts nothing was added says what it is counting.
const BASE_NOTE_COUNT = 2

// The other direction of the same question (joshuafolkken/kit#1330). Two sessions attributed to one
// issue really can run at the same wall clock, and neither's spans may be trimmed away — both worked
// in the minutes they shared, which is why `time-corpus.ts` groups them per session rather than
// pooling their intervals. So the shares total more than the window, and until this was said the
// header read as a run twice as long as the window printed beside it: `--issue 1299` reported
// 77.6 min over a window of 49.9.
// A session that delegates a unit, and a second session working the same three minutes. The
// parent/unit half is subtracted as usual; the second session's spans are what is left over.
function write_overlapping_run(): void {
	write_session('parent', fixture.delegating_lines())
	write_unit('parent', 'agent-a1', fixture.issue_lines(0))
	write_session('other', fixture.concurrent_lines())
}

describe('time_run.build_run_report — transcripts that overlap in wall clock', () => {
	it('detects the excess when the shares total more than the window they sit in', async () => {
		write_overlapping_run()

		const report = await report_of(NO_PULL_SCRIPT)

		// Six minutes of shares over a three-minute window: three of them are counted twice.
		expect(report.elapsed_ms).toBe(2 * THREE_MINUTES_MS)
		expect(report.notes.join(NOTE_SEPARATOR)).toContain('3.0 min of it wall clock concurrent')
	})

	// The percentages are taken against the accounted total, so a reader who assumes the window is the
	// denominator is ranking the phases against a number the report never used.
	it('names the denominator every share and phase percentage is taken against', async () => {
		write_overlapping_run()

		const report = await report_of(NO_PULL_SCRIPT)

		expect(report.notes.join(NOTE_SEPARATOR)).toContain(
			'every share and phase percentage is of the 6.0 min',
		)
	})

	// The guarantee the note is not allowed to cost: a run whose sessions did not overlap reports
	// exactly what it reported before, note for note.
	it('says nothing where the window and the shares already agree', async () => {
		write_session('one', issue_lines(0))

		const report = await report_of(NO_PULL_SCRIPT)

		expect(report.elapsed_ms).toBe(Date.parse(report.ended_at) - Date.parse(report.started_at))
		expect(report.notes).toHaveLength(BASE_NOTE_COUNT)
	})
})

// Which sessions the run's figures were taken from, said out loud (joshuafolkken/kit#1428). A branch
// belongs to the checkout, so a second session open in the same work tree used to be summed into every
// figure with nothing saying so.
describe('time_run.build_run_report — sessions that only shared the checkout', () => {
	it('names the concurrent session it left out, with its minutes', async () => {
		write_session('ran', fixture.run_lines(0))
		write_session('other', fixture.concurrent_lines())

		const report = await report_of(NO_PULL_SCRIPT)

		expect(report.elapsed_ms).toBe(THREE_MINUTES_MS)
		expect(report.notes.join(NOTE_SEPARATOR)).toContain('1 concurrent session(s) left out')
		expect(report.notes.join(NOTE_SEPARATOR)).toContain('other (3.0 min)')
	})

	// `0` excluded and "could not be separated" are different answers, and only one of them is a
	// measurement — so the second is printed in words rather than as an exclusion of nothing.
	it('says the run could not be separated rather than reporting nothing excluded', async () => {
		write_session('one', issue_lines(0))
		write_session('other', fixture.concurrent_lines())

		const report = await report_of(NO_PULL_SCRIPT)
		const notes = report.notes.join(NOTE_SEPARATOR)

		expect(notes).toContain('2 sessions are attributed to issue')
		expect(notes).toContain('the run could not be separated from them')
		expect(notes).not.toContain('left out')
	})

	// The guarantee neither note is allowed to cost: a run measured in one session reports exactly what
	// it reported before, note for note.
	it('says nothing where one session holds the whole run', async () => {
		write_session('ran', fixture.run_lines(0))

		const report = await report_of(NO_PULL_SCRIPT)

		expect(report.notes).toHaveLength(BASE_NOTE_COUNT)
	})
})

// A merge on a branch that is not `<N>-<slug>` names no issue, and guessing one would report some
// other run's figures under its number.
const NON_ISSUE_PULL = `[{"number":1,"created_at":"${at(0)}","merged_at":"${at(1)}","head":{"ref":"renovate/x","sha":"${SHA}"}}]`

describe('time_run.build_latest_run_report', () => {
	it('reports the run of the most recently merged branch, paging the listing once', async () => {
		write_session('one', issue_lines(0))
		const asked: Array<string> = []
		const report = await time_run.build_latest_run_report(CWD, reader(MERGED_SCRIPT, asked))

		expect(report?.scope).toBe(`issue #${String(ISSUE)}`)
		// One pulls listing and one check-run read. Resolving the issue and then searching for its
		// pull request again would page the same listing a second time.
		expect(pulls_asked(asked)).toHaveLength(1)
	})

	it('answers nothing when nothing merged carries an issue branch', async () => {
		const report = await time_run.build_latest_run_report(
			CWD,
			reader({ pull_body: NON_ISSUE_PULL }),
		)

		expect(report).toBeUndefined()
	})
})

// The batch's way in: a caller measuring several issues has already walked the corpus and paged the
// pull-request listing once for all of them, and handing this one its slices is what stops both
// repeating per child (joshuafolkken/kit#1284 and joshuafolkken/kit#1292).
describe('time_run.build_run_report — sources the caller already collected', () => {
	it('reads no transcript of its own when it is given them', async () => {
		write_session('one', issue_lines(0))

		const collected = time_corpus.collect_issue_spans(CWD, ISSUE)
		const read = vi.spyOn(cost_transcript, 'read_raw')
		const report = await time_run.build_run_report(ISSUE, CWD, reader(MERGED_SCRIPT), {
			found: collected,
			search: undefined,
		})

		expect(read).not.toHaveBeenCalled()
		expect(report.span_count).toBe(2)
	})

	// The listing half: given the child's search result, the report must not page the listing again.
	it('pages no pull-request listing of its own when it is given the search', async () => {
		write_session('one', issue_lines(0))

		const asked: Array<string> = []
		const search = await time_pull_index.pull_for_issue(ISSUE, reader(MERGED_SCRIPT))
		const report = await time_run.build_run_report(ISSUE, CWD, reader(MERGED_SCRIPT, asked), {
			found: undefined,
			search,
		})

		expect(pulls_asked(asked)).toHaveLength(0)
		expect(report.has_ci_data).toBe(true)
	})

	// The default is what `--issue` does, so leaving the argument out must still read both halves.
	it('reads both halves itself when it is given neither', async () => {
		write_session('one', issue_lines(0))

		const asked: Array<string> = []
		const read = vi.spyOn(cost_transcript, 'read_raw')
		const report = await time_run.build_run_report(ISSUE, CWD, reader(MERGED_SCRIPT, asked))

		expect(read).toHaveBeenCalled()
		expect(pulls_asked(asked)).toHaveLength(1)
		expect(report.span_count).toBe(2)
	})
})
