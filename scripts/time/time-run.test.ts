import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cost_transcript } from '#scripts/cost/cost-transcript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { time_corpus } from './time-corpus'
import type { GhReader } from './time-github'
import { time_report, type TimeReport } from './time-report'
import { time_run } from './time-run'
import { time_transcript_fixture as fixture } from './time-transcript-fixture'

// The transcript fixtures are `time-transcript-fixture.ts`'s, shared with the suite that covers the
// walk itself: what a session file looks like is one statement, not one per suite.
const { CWD, MINUTE_MS, ISSUE, BRANCH, at, ms, issue_lines } = fixture
const SHA = 'abc123'

const state = { home: '' }

beforeEach(() => {
	state.home = mkdtempSync(path.join(tmpdir(), 'time-run-'))
	vi.spyOn(cost_transcript, 'transcript_directory').mockImplementation((cwd: string) =>
		path.join(state.home, cost_transcript.project_slug(cwd)),
	)
})

afterEach(() => {
	vi.restoreAllMocks()
})

function write_session(name: string, lines: ReadonlyArray<string>): void {
	fixture.write_session(state.home, name, lines)
}

interface GhScript {
	pull_body: string
	checks_body?: string
}

function reader(script: GhScript, asked: Array<string> = []): GhReader {
	return async (request_path: string) => {
		asked.push(request_path)

		if (request_path.includes('check-runs')) return script.checks_body ?? '{}'

		return script.pull_body
	}
}

// The merge instant is written into the JSON text rather than as a value, because an open pull
// request carries a wire `null` and the fixture should state the wire format.
function pull_body(created: number, merged_at: string): string {
	return `[{"number":1279,"created_at":"${at(created)}","merged_at":${merged_at},"head":{"ref":"${BRANCH}","sha":"${SHA}"}}]`
}

function merged_pull(created: number, merged: number): string {
	return pull_body(created, `"${at(merged)}"`)
}

function open_pull(created: number): string {
	return pull_body(created, 'null')
}

// The pull request every case below shares: opened at minute 2, merged at minute 8.
const MERGED_SCRIPT: GhScript = { pull_body: merged_pull(2, 8) }
const NO_PULL_SCRIPT: GhScript = { pull_body: '[]' }
const NOTE_SEPARATOR = '\n'

async function report_of(script: GhScript): Promise<TimeReport> {
	return await time_run.build_run_report(ISSUE, CWD, reader(script))
}

function checks_body(name: string, started: number, completed: number): string {
	return JSON.stringify({
		check_runs: [{ name, started_at: at(started), completed_at: at(completed) }],
	})
}

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

		const report = await report_of({ ...MERGED_SCRIPT, checks_body: checks_body('unit', 3, 7) })

		expect(report.by_check).toEqual([{ label: 'unit', duration_ms: 4 * MINUTE_MS, call_count: 1 }])
	})

	// GitHub really does stamp a check as completed before it started — `Notify Auto Tag` on PR #1277
	// printed as `-0.0 min`. That is a clock artefact, and a reader takes a negative row for a figure.
	it('never prints a negative duration for a check whose clocks disagree', async () => {
		write_session('one', issue_lines(0))

		const report = await report_of({ ...MERGED_SCRIPT, checks_body: checks_body('notify', 7, 6) })

		expect(report.by_check).toEqual([{ label: 'notify', duration_ms: 0, call_count: 1 }])
	})
})

async function refuse(): Promise<string> {
	throw new Error('gh: 403')
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
		expect(asked.filter((request_path) => request_path.includes('pulls'))).toHaveLength(1)
	})

	it('answers nothing when nothing merged carries an issue branch', async () => {
		const report = await time_run.build_latest_run_report(
			CWD,
			reader({ pull_body: NON_ISSUE_PULL }),
		)

		expect(report).toBeUndefined()
	})
})

// The batch's way in: a caller measuring several issues has already walked the corpus once for all
// of them, and handing this one its slice is what stops the walk repeating per child
// (joshuafolkken/kit#1284).
describe('time_run.build_run_report — spans the caller already collected', () => {
	it('reads no transcript of its own when it is given them', async () => {
		write_session('one', issue_lines(0))

		const collected = time_corpus.collect_issue_spans(CWD, ISSUE)
		const read = vi.spyOn(cost_transcript, 'read_raw')
		const report = await time_run.build_run_report(ISSUE, CWD, reader(MERGED_SCRIPT), collected)

		expect(read).not.toHaveBeenCalled()
		expect(report.span_count).toBe(2)
	})

	// The default is what `--issue` does, so leaving the argument out must still walk the directory.
	it('walks the directory itself when it is given none', async () => {
		write_session('one', issue_lines(0))

		const read = vi.spyOn(cost_transcript, 'read_raw')
		const report = await report_of(MERGED_SCRIPT)

		expect(read).toHaveBeenCalled()
		expect(report.span_count).toBe(2)
	})
})
