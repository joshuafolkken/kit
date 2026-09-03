import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cost_transcript } from '#scripts/cost/cost-transcript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GhReader } from './time-github'
import { time_report, type TimeReport } from './time-report'
import { time_run } from './time-run'

const CWD = '/Users/someone/Development/kit'
const MINUTE_MS = 60_000
const ISSUE = 1268
const BRANCH = '1268-measure-a-run'
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

function at(minute: number): string {
	return new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString()
}

function ms(minute: number): number {
	return Date.parse(at(minute))
}

function prompt_line(minute: number, branch: string): string {
	return JSON.stringify({
		type: 'user',
		timestamp: at(minute),
		gitBranch: branch,
		message: { content: 'go' },
	})
}

function call_line(minute: number, branch: string): string {
	return JSON.stringify({
		type: 'assistant',
		timestamp: at(minute),
		gitBranch: branch,
		message: { content: [{ type: 'tool_use', name: 'Read', id: 'a' }] },
	})
}

function result_line(minute: number, branch: string): string {
	return JSON.stringify({
		type: 'user',
		timestamp: at(minute),
		gitBranch: branch,
		message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: 'ok' }] },
	})
}

function write_session(name: string, lines: ReadonlyArray<string>): void {
	const directory = path.join(state.home, cost_transcript.project_slug(CWD))

	mkdirSync(directory, { recursive: true })
	writeFileSync(
		path.join(directory, `${name}${cost_transcript.TRANSCRIPT_EXTENSION}`),
		lines.join('\n'),
	)
}

// Minutes 0→1 model wait, 1→3 tool execution, all on the issue's branch.
function issue_lines(offset: number): Array<string> {
	return [
		prompt_line(offset, BRANCH),
		call_line(offset + 1, BRANCH),
		result_line(offset + 3, BRANCH),
	]
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

describe('time_run.uncovered_ms', () => {
	// The property the whole join rests on. `followup --merge` waits for CI inside a Bash tool span
	// that is already counted, so adding the pull request's window whole would count it twice and
	// leave the four shares summing to more than the run took.
	it('subtracts the part of the window a span already covers', () => {
		const uncovered = time_run.uncovered_ms({ started_ms: 0, ended_ms: 10 }, [
			{ started_ms: 2, ended_ms: 6 },
		])

		expect(uncovered).toBe(6)
	})

	it('merges overlapping and out-of-order covers rather than double-subtracting', () => {
		const uncovered = time_run.uncovered_ms({ started_ms: 0, ended_ms: 10 }, [
			{ started_ms: 4, ended_ms: 8 },
			{ started_ms: 2, ended_ms: 6 },
		])

		expect(uncovered).toBe(4)
	})

	it('ignores a cover that lies entirely outside the window', () => {
		const uncovered = time_run.uncovered_ms({ started_ms: 10, ended_ms: 20 }, [
			{ started_ms: 0, ended_ms: 5 },
			{ started_ms: 40, ended_ms: 50 },
		])

		expect(uncovered).toBe(10)
	})

	it('answers zero for a window with no length', () => {
		expect(time_run.uncovered_ms({ started_ms: 5, ended_ms: 5 }, [])).toBe(0)
	})
})

describe('time_run.collect_issue_spans', () => {
	// A run is not a session: the `fullrun` for issue #1256 ran in a different one from the session
	// that reported it, so a command reading one transcript reports half a run.
	it('adds up every session attributed to the issue', () => {
		write_session('one', issue_lines(0))
		write_session('two', issue_lines(10))

		const found = time_run.collect_issue_spans(CWD, ISSUE)

		expect(found.session_count).toBe(2)
		expect(found.spans).toHaveLength(4)
	})

	it('leaves out a session that never touched the issue', () => {
		const elsewhere = '999-elsewhere'

		write_session('one', issue_lines(0))
		write_session('other', [
			prompt_line(0, elsewhere),
			call_line(1, elsewhere),
			result_line(3, elsewhere),
		])

		expect(time_run.collect_issue_spans(CWD, ISSUE).session_count).toBe(1)
	})

	// Resuming or forking a session copies the earlier lines into a new file. Counted twice, a run
	// spanning sessions reports time nobody spent.
	it('counts a span copied into a resumed transcript once', () => {
		write_session('one', issue_lines(0))
		write_session('resumed', [...issue_lines(0), call_line(5, BRANCH), result_line(6, BRANCH)])

		// The first session contributes two spans and the resumed one four, two of which are the
		// copies. Counted naively that is six; the run really spent four.
		expect(time_run.collect_issue_spans(CWD, ISSUE).spans).toHaveLength(4)
	})

	// A session that contributed only copies is not a session the note may count: `2 session(s)`
	// beside a span total that correctly counted those spans once is the note contradicting the
	// arithmetic printed beside it.
	it('does not count a transcript that was purely a copy of another', () => {
		write_session('one', issue_lines(0))
		write_session('copy', issue_lines(0))

		expect(time_run.collect_issue_spans(CWD, ISSUE).session_count).toBe(1)
	})

	// The fill-forward walk is `cost_attribute`'s and is reused, not copied: work done on the default
	// branch before `josh git` created the branch still belongs to the issue.
	it('claims the work done on the default branch before the branch existed', () => {
		write_session('one', [prompt_line(0, 'main'), call_line(1, 'main'), result_line(3, BRANCH)])

		expect(time_run.collect_issue_spans(CWD, ISSUE).spans).toHaveLength(2)
	})
})

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
