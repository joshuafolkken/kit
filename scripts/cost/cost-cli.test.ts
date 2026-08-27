import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cost_cli } from './cost-cli'
import { cost_transcript } from './cost-transcript'

const CWD = '/Users/someone/Development/kit'
const FAILURE_EXIT_CODE = 1
const ISSUE_BRANCH = '962-report-the-token-and-credit-cost-of-a-run'
const MAIN = 'main'
const SESSION_A = 'session-a'
const SESSION_B = 'session-b'
const BAD_LINE = '{ not json'
const ISSUE_FLAG = '--issue'
const BAD_FLAG = '--nonsense'
const NO_TRANSCRIPTS = 'No transcripts found'
const ONE_REQUEST_FOR_962 = 'issue #962 — 1 request(s)'
const ISSUE_NUMBER = '962'

function usage_line(request_id: string, branch: string, output_tokens: number): string {
	return JSON.stringify({
		type: 'assistant',
		requestId: request_id,
		gitBranch: branch,
		message: { model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens } },
	})
}

// Mutated properties rather than reassigned bindings, so `beforeEach` never assigns to a top-level
// variable from inside a function.
const state = { home: '', printed: [] as Array<string> }

function capture(message: unknown): void {
	state.printed.push(String(message))
}

beforeEach(() => {
	state.home = mkdtempSync(path.join(tmpdir(), 'cost-cli-'))
	state.printed = []
	vi.spyOn(console, 'info').mockImplementation(capture)
	vi.spyOn(console, 'error').mockImplementation(capture)
	vi.spyOn(cost_transcript, 'transcript_directory').mockImplementation((cwd: string) =>
		path.join(state.home, cost_transcript.project_slug(cwd)),
	)
})

afterEach(() => {
	vi.restoreAllMocks()
})

function write_session(session_id: string, lines: ReadonlyArray<string>): void {
	const directory = path.join(state.home, cost_transcript.project_slug(CWD))

	mkdirSync(directory, { recursive: true })
	writeFileSync(path.join(directory, `${session_id}.jsonl`), lines.join('\n'))
}

function output(): string {
	return state.printed.join('\n')
}

describe('josh cost registration', () => {
	it('is registered as a josh command', () => {
		const { cost } = COMMAND_MAP

		expect(cost?.script).toBe('scripts/cost/cost-cli.ts')
	})

	it('has a short alias', () => {
		const { co } = ALIASES

		expect(co).toBe('cost')
	})
})

describe('cost_cli.parse_options', () => {
	it('reads an issue number', () => {
		expect(cost_cli.parse_options([ISSUE_FLAG, ISSUE_NUMBER])?.issue).toBe(962)
	})

	it('refuses an issue that is not a number', () => {
		expect(cost_cli.parse_options([ISSUE_FLAG, 'abc'])).toBeUndefined()
	})

	it('refuses an unknown flag rather than ignoring it', () => {
		expect(cost_cli.parse_options([BAD_FLAG])).toBeUndefined()
	})

	it('defaults to the newest session with no flags', () => {
		expect(cost_cli.parse_options([])).toStrictEqual({ is_all: false, is_json: false })
	})
})

describe('cost_cli.run on one session', () => {
	it('reports the newest session by default', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10)])

		expect(cost_cli.run([], CWD)).toBe(0)
		expect(output()).toContain(`session ${SESSION_A}`)
	})

	// The failure this command exists to remove: reading nothing and reporting it as a free run.
	it('reports a missing transcript as an error, not as a zero-cost run', () => {
		expect(cost_cli.run([], CWD)).toBe(FAILURE_EXIT_CODE)
		expect(output()).toContain(NO_TRANSCRIPTS)
		expect(output()).not.toContain('$0.0000')
	})

	it('reports a named session that does not exist as missing', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10)])

		expect(cost_cli.run(['--session', 'absent'], CWD)).toBe(FAILURE_EXIT_CODE)
	})

	it('prints the usage line for a bad invocation', () => {
		expect(cost_cli.run([BAD_FLAG], CWD)).toBe(FAILURE_EXIT_CODE)
		expect(output()).toContain(cost_cli.USAGE)
	})

	it('emits machine-readable output for --json', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10)])

		expect(cost_cli.run(['--json'], CWD)).toBe(0)
		expect(JSON.parse(output())).toMatchObject([{ request_count: 1 }])
	})
})

describe('cost_cli.run across sessions', () => {
	it('rolls an issue up across every session that touched it', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10), usage_line('r2', ISSUE_BRANCH, 10)])
		write_session(SESSION_B, [usage_line('r3', ISSUE_BRANCH, 10)])

		expect(cost_cli.run([ISSUE_FLAG, ISSUE_NUMBER], CWD)).toBe(0)
		expect(output()).toContain('issue #962 — 3 request(s)')
	})

	it('lists every issue and a grand total under --all', () => {
		write_session(SESSION_A, [
			usage_line('r1', ISSUE_BRANCH, 10),
			usage_line('r2', '963-next-one', 10),
		])

		expect(cost_cli.run(['--all'], CWD)).toBe(0)
		expect(output()).toContain('issue #962')
		expect(output()).toContain('issue #963')
		expect(output()).toContain('Total across 2 scope(s)')
	})
})

// `--all` and `--issue` used to answer an absent transcript directory with an empty listing and a
// zero-cost issue — exit 0 either way, which is the silent zero this command exists to remove.
describe('cost_cli.run on an absent transcript directory', () => {
	it('exits non-zero for --all rather than printing nothing', () => {
		expect(cost_cli.run(['--all'], CWD)).toBe(FAILURE_EXIT_CODE)
		expect(output()).toContain(NO_TRANSCRIPTS)
	})

	it('exits non-zero for --issue rather than blaming attribution', () => {
		expect(cost_cli.run([ISSUE_FLAG, ISSUE_NUMBER], CWD)).toBe(FAILURE_EXIT_CODE)
		expect(output()).not.toContain('No requests are attributed')
	})

	it('names the session that was asked for when one was named', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10)])

		expect(cost_cli.run(['--session', 'absent'], CWD)).toBe(FAILURE_EXIT_CODE)
		expect(output()).toContain('No transcript named absent')
	})
})

// Resuming or forking a session copies the earlier lines into a new transcript file, so one billed
// request appears in several — 152 such request ids in this repository's own transcripts.
describe('cost_cli.run across sessions that share requests', () => {
	it('counts a request copied into a second transcript once', () => {
		write_session(SESSION_A, [usage_line('r1', ISSUE_BRANCH, 10)])
		write_session(SESSION_B, [usage_line('r1', ISSUE_BRANCH, 10)])

		expect(cost_cli.run([ISSUE_FLAG, ISSUE_NUMBER], CWD)).toBe(0)
		expect(output()).toContain(ONE_REQUEST_FOR_962)
	})

	it('keeps the attributed copy when the other copy has no branch to attribute it to', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10)])
		write_session(SESSION_B, [usage_line('r1', ISSUE_BRANCH, 10)])

		expect(cost_cli.run(['--all'], CWD)).toBe(0)
		expect(output()).toContain(ONE_REQUEST_FOR_962)
		expect(output()).not.toContain('unattributed')
	})
})

// A malformed line in an unrelated session is not missing data about the session being reported;
// summing the whole corpus into a single-session report blamed one run for another's defect.
describe('cost_cli.run missing-data scoping', () => {
	it("reports only the named session's own missing lines", () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10)])
		write_session(SESSION_B, [BAD_LINE, BAD_LINE])

		expect(cost_cli.run(['--session', SESSION_A], CWD)).toBe(0)
		expect(output()).not.toContain('Missing data')
	})

	// A line that could not be read carries no branch, so there is no way to rule out that it
	// belonged to the issue being rolled up.
	it('still reports the corpus-wide missing lines for an issue rollup', () => {
		write_session(SESSION_A, [usage_line('r1', ISSUE_BRANCH, 10)])
		write_session(SESSION_B, [BAD_LINE])

		expect(cost_cli.run([ISSUE_FLAG, ISSUE_NUMBER], CWD)).toBe(0)
		expect(output()).toContain('unparseable lines: 1')
	})
})
