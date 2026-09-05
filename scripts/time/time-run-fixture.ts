import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cost_transcript } from '#scripts/cost/cost-transcript'
import { afterEach, beforeEach, vi } from 'vitest'
import type { GhReader } from './time-github'
import type { TimeReport } from './time-report'
import { time_run } from './time-run'
import { time_transcript_fixture as fixture } from './time-transcript-fixture'

// What a measured run looks like from both sides: a transcript on disk, and a `gh` that answers.
//
// It moved out of `time-run.test.ts` when the CI-cycle suite joined it and the file passed its length
// limit (joshuafolkken/kit#1384) — the move `time-phase-fixture.ts` already made for the same reason.
// A second copy of the scripted reader beside the second suite is the clone `CLAUDE.md` prohibits, in
// the one place a drift would make two suites disagree about what GitHub answered.

const { CWD, ISSUE, BRANCH, at } = fixture

const SHA = 'abc123'

// Which of the three reads a request is. The check-runs path sits under `commits/<sha>/`, so the two
// marks cannot match the same path: only the commit *listing* carries a query right after the word.
const CHECK_RUNS_MARK = 'check-runs'
const COMMITS_MARK = '/commits?'
// The merged diff's file listing, which sits under `pulls/<n>/` like the commit listing does
// (joshuafolkken/kit#1387). Matched on the query so it cannot collide with a path a test writes.
const FILES_MARK = '/files?'
const GH_REFUSAL = 'gh: 403'

// One scripted `gh`. Each read has a refusal flag of its own, because they are separate requests and
// a rate limit hits one of them at a time (joshuafolkken/kit#1352, joshuafolkken/kit#1384,
// joshuafolkken/kit#1387).
interface GhScript {
	pull_body: string
	checks_body?: string
	commits_body?: string
	files_body?: string
	is_checks_refused?: boolean
	is_commits_refused?: boolean
	is_files_refused?: boolean
}

const state = { home: '' }

// The temporary transcript home each test writes into, and the mock that points the walk at it.
// Called at the top of a suite: the hooks are registered where the suite is defined, exactly as they
// would be written out in the file itself.
function use_transcript_home(): void {
	beforeEach(() => {
		state.home = mkdtempSync(path.join(tmpdir(), 'time-run-'))
		vi.spyOn(cost_transcript, 'transcript_directory').mockImplementation((cwd: string) =>
			path.join(state.home, cost_transcript.project_slug(cwd)),
		)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})
}

function write_session(name: string, lines: ReadonlyArray<string>): void {
	fixture.write_session(state.home, name, lines)
}

// A delegated unit's transcript, which Claude Code writes under the session that delegated it.
function write_unit(session: string, agent: string, lines: ReadonlyArray<string>): void {
	fixture.write_unit(state.home, session, agent, lines)
}

function checks_of(script: GhScript): string {
	if (script.is_checks_refused === true) throw new Error(GH_REFUSAL)

	return script.checks_body ?? '{}'
}

function commits_of(script: GhScript): string {
	if (script.is_commits_refused === true) throw new Error(GH_REFUSAL)

	return script.commits_body ?? '[]'
}

// **The default is an empty listing, not the pull body.** A merged pull request is read for its files
// on every run now, and letting that request fall through to the listing body would hand the file
// schema an array of pull requests — a read every existing case would then report as refused.
function files_of(script: GhScript): string {
	if (script.is_files_refused === true) throw new Error(GH_REFUSAL)

	return script.files_body ?? '[]'
}

function reader(script: GhScript, asked: Array<string> = []): GhReader {
	return async (request_path: string) => {
		asked.push(request_path)

		if (request_path.includes(CHECK_RUNS_MARK)) return checks_of(script)
		if (request_path.includes(COMMITS_MARK)) return commits_of(script)
		if (request_path.includes(FILES_MARK)) return files_of(script)

		return script.pull_body
	}
}

// One row of a merged diff, as GitHub writes it.
function pull_file(filename: string, additions: number, deletions: number): object {
	return { filename, additions, deletions }
}

function files_body(files: ReadonlyArray<object>): string {
	return JSON.stringify(files)
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

async function report_of(script: GhScript): Promise<TimeReport> {
	return await time_run.build_run_report(ISSUE, CWD, reader(script))
}

const SUCCESS = 'success'

function check_run(name: string, conclusion: string, started: number, completed: number): object {
	return { name, conclusion, started_at: at(started), completed_at: at(completed) }
}

function checks_body(name: string, started: number, completed: number): string {
	return JSON.stringify({ check_runs: [check_run(name, SUCCESS, started, completed)] })
}

const time_run_fixture = {
	SHA,
	SUCCESS,
	GH_REFUSAL,
	use_transcript_home,
	write_session,
	write_unit,
	reader,
	pull_body,
	merged_pull,
	open_pull,
	report_of,
	check_run,
	checks_body,
	pull_file,
	files_body,
}

export type { GhScript }
export { time_run_fixture }
