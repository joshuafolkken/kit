import { readFileSync } from 'node:fs'
import type { IssueState } from '#scripts/issue/issue-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunCarry } from './run-carry'
import { run_status } from './run-status'

const read_state_mock = vi.hoisted(() => vi.fn())
const verdict_mock = vi.hoisted(() => vi.fn())
const repository_directory_mock = vi.hoisted(() => vi.fn())
const carry_path_mock = vi.hoisted(() => vi.fn())
const read_carry_mock = vi.hoisted(() => vi.fn())
const describe_carry_mock = vi.hoisted(() => vi.fn())
const info_mock = vi.hoisted(() => vi.fn())
const error_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: { read_issue: read_state_mock },
}))

vi.mock('#scripts/cost-runtime/cost-cli', () => ({
	cost_cli: { session_verdict: verdict_mock, UNMEASURABLE_VERDICT: 'unmeasurable' },
}))

vi.mock('./run-carry', () => ({
	run_carry: {
		repository_directory: repository_directory_mock,
		carry_path: carry_path_mock,
		read_carry: read_carry_mock,
		describe_carry: describe_carry_mock,
	},
}))

const { run_status_cli } = await import('./run-status-cli')

const SUCCESS = 0
const FAILURE = 1
const ISSUE = '2165'
const OTHER_ISSUE = '2166'
const REPO = 'joshuafolkken/kit'
const UNDER = 'under'
const UNMEASURABLE = 'unmeasurable'
const CARRY_MISSING_NOTE = 'run record not bundled'
const CLI_PATH = 'scripts/run/run-status-cli.ts'
const OPEN_STATE: IssueState = { state: 'OPEN', labels: ['in-progress'], is_human_review: false }
const CARRY: RunCarry = {
	invocation: 'backlogrun --max 5',
	started_at: '2026-09-20T00:00:00Z',
	merged: 2,
	filed: 0,
	cuts: 0,
	failures: 0,
}
const CARRY_DESC = 'backlogrun --max 5 started …; 2 merged'

function printed(): string {
	return info_mock.mock.calls.map((call) => String(call[0])).join('\n')
}

function reported(): string {
	return error_mock.mock.calls.map((call) => String(call[0])).join('\n')
}

function reset_mocks(): void {
	const mocks = [
		read_state_mock,
		verdict_mock,
		repository_directory_mock,
		carry_path_mock,
		read_carry_mock,
		describe_carry_mock,
		info_mock,
		error_mock,
	]

	for (const mock of mocks) mock.mockReset()
}

function stub_ok(): void {
	read_state_mock.mockResolvedValue({ kind: 'state', state: OPEN_STATE })
	verdict_mock.mockReturnValue(UNDER)
	repository_directory_mock.mockResolvedValue('/repo/.git')
	read_carry_mock.mockReturnValue({ kind: 'carried', carry: CARRY })
	describe_carry_mock.mockReturnValue(CARRY_DESC)
}

beforeEach(() => {
	reset_mocks()
	carry_path_mock.mockReturnValue('/repo/.git/carry')
	vi.spyOn(console, 'info').mockImplementation(info_mock)
	vi.spyOn(console, 'error').mockImplementation(error_mock)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_status_cli.parse', () => {
	it('reads a single issue number', () => {
		expect(run_status_cli.parse([ISSUE])).toEqual({ issue_number: ISSUE })
	})

	it('reads a repository flag beside the number', () => {
		expect(run_status_cli.parse([ISSUE, '--repo', REPO])).toEqual({
			issue_number: ISSUE,
			repo: REPO,
		})
	})

	it('refuses a second number', () => {
		expect(run_status_cli.parse([ISSUE, OTHER_ISSUE])).toBeUndefined()
	})

	it('refuses a token that is not a number', () => {
		expect(run_status_cli.parse(['#2165'])).toBeUndefined()
	})
})

describe('run_status_cli.run bundles the three reads', () => {
	it('joins the state, cost verdict and carry counters into one report', async () => {
		stub_ok()

		expect(await run_status_cli.run([ISSUE])).toBe(SUCCESS)

		const out = printed()
		const expected = [
			`${run_status.SUMMARY_PREFIX}${ISSUE}`,
			run_status.STATE_HEADER,
			'labels: in-progress',
			run_status.COST_HEADER,
			UNDER,
			run_status.RUN_HEADER,
			CARRY_DESC,
		]

		expect(expected.every((part) => out.includes(part))).toBe(true)
	})

	it('reads all three parts in one invocation', async () => {
		stub_ok()

		await run_status_cli.run([ISSUE])

		expect(read_state_mock).toHaveBeenCalledTimes(1)
		expect(verdict_mock).toHaveBeenCalledTimes(1)
		expect(read_carry_mock).toHaveBeenCalledTimes(1)
	})

	it('passes the repository through to the state read', async () => {
		stub_ok()

		await run_status_cli.run([ISSUE, '--repo', REPO])

		expect(read_state_mock).toHaveBeenCalledWith(ISSUE, REPO)
	})

	it('reports no run recorded as a valid answer, not a failure', async () => {
		stub_ok()
		read_carry_mock.mockReturnValue({ kind: 'none' })

		expect(await run_status_cli.run([ISSUE])).toBe(SUCCESS)
		expect(printed()).toContain('no run recorded')
	})
})

describe('run_status_cli.run surfaces a failed read without dropping the rest', () => {
	it('notes a failed state read but keeps the other two', async () => {
		stub_ok()
		read_state_mock.mockResolvedValue({ kind: 'unreadable' })

		expect(await run_status_cli.run([ISSUE])).toBe(FAILURE)

		const out = printed()

		expect(out).toContain('not bundled: unreadable')
		expect(out).toContain(CARRY_DESC)
		expect(out).toContain(UNDER)
	})

	it('marks an unreadable carry record and stays non-zero', async () => {
		stub_ok()
		read_carry_mock.mockReturnValue({ kind: 'unreadable' })

		expect(await run_status_cli.run([ISSUE])).toBe(FAILURE)
		expect(printed()).toContain(CARRY_MISSING_NOTE)
	})

	it('treats a git directory that could not be read as an unreadable record', async () => {
		stub_ok()
		repository_directory_mock.mockResolvedValue(undefined)

		expect(await run_status_cli.run([ISSUE])).toBe(FAILURE)
		expect(read_carry_mock).not.toHaveBeenCalled()
		expect(printed()).toContain(CARRY_MISSING_NOTE)
	})

	it('keeps a session that cannot be priced non-zero', async () => {
		stub_ok()
		verdict_mock.mockReturnValue(UNMEASURABLE)

		expect(await run_status_cli.run([ISSUE])).toBe(FAILURE)
		expect(printed()).toContain(UNMEASURABLE)
	})

	it('refuses no argument', async () => {
		expect(await run_status_cli.run([])).toBe(FAILURE)
		expect(reported()).toContain('Usage')
	})
})

// The command answers "where does this run stand" and must never mutate what it reads: `run:hold`'s
// claim and `run:progress`'s clock mark are the writes it deliberately leaves out (joshuafolkken/kit#2165).
describe('run:status is read-only', () => {
	const source = readFileSync(CLI_PATH, 'utf8')

	it.each(['write_stamp', 'create_stamp', 'remove_stamp', 'apply_change', 'run_hold', "'--mark'"])(
		'does not reference the write %s',
		(token) => {
			expect(source).not.toContain(token)
		},
	)
})

describe('josh run:status registration', () => {
	it('is registered as a josh command', () => {
		const source = readFileSync('scripts/josh/josh-commands-ai.ts', 'utf8')

		expect(source).toContain("'run:status'")
		expect(source).toContain(CLI_PATH)
	})

	it('has the rst alias', () => {
		const source = readFileSync('scripts/josh/josh-command-map.ts', 'utf8')

		expect(source).toContain("rst: 'run:status'")
	})
})
