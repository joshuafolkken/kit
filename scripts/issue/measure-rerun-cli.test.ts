import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { afterAll, afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { measure_rerun_cli } from './measure-rerun-cli'

vi.mock('#scripts/observations/observation-ledger-home', async (original) => {
	const actual = await original<{ observation_ledger_home: typeof observation_ledger_home }>()

	return { observation_ledger_home: { ...actual.observation_ledger_home, writer_path: vi.fn() } }
})

vi.mock('#scripts/gh/git-gh-issue-read', () => ({
	git_gh_issue_read: { issue_view_json: vi.fn() },
}))

const api_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gh/git-gh-exec', () => ({ git_gh_exec: { exec_gh_api: api_mock } }))

vi.mock('node:child_process', async (original) => {
	const actual = await original<{ execSync: typeof execSync }>()

	return { ...actual, execSync: vi.fn(actual.execSync) }
})

const TEST_DIR = mkdtempSync(path.join(tmpdir(), 'measure-rerun-'))
const NOW = new Date('2026-09-23T00:00:00Z')
const ISSUE = '2212'
const HEADING = '## ベースライン'
const ECHO_LINE = '- `echo hi` → hi'
const BODY = [HEADING, '', ECHO_LINE, ''].join('\n')
const TWO_BASELINES = [HEADING, '', '- `sleep 999` → 1', ECHO_LINE, ''].join('\n')
const TIMEOUT_MESSAGE = 'spawnSync /bin/sh ETIMEDOUT'
const mocked_exec_sync = vi.mocked(execSync)
const mocked_issue_view = vi.mocked(git_gh_issue_read.issue_view_json)

function issue_json(body: string, author_association: string, login = 'author'): string {
	return JSON.stringify({ body, author_association, user: { login } })
}

// An issue by `login`, a `MEMBER` / `COLLABORATOR` whose permission lookup answers `role_name`.
function use_asked_author(
	body: string,
	association: string,
	login: string,
	role_name: string,
): void {
	mocked_issue_view.mockResolvedValue(issue_json(body, association, login))
	api_mock.mockResolvedValue(JSON.stringify({ permission: role_name, role_name }))
}

function silence_console(): MockInstance<typeof console.info> {
	vi.spyOn(console, 'error').mockImplementation(() => undefined)

	return vi.spyOn(console, 'info').mockImplementation(() => undefined)
}

function use_ledger(name: string): string {
	const ledger_path = path.join(TEST_DIR, name)

	vi.mocked(observation_ledger_home.writer_path).mockResolvedValue(ledger_path)

	return ledger_path
}

afterEach(() => {
	vi.restoreAllMocks()
	mocked_exec_sync.mockClear()
	mocked_issue_view.mockReset()
	api_mock.mockReset()
})

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

// joshuafolkken/kit#2919: a refuted premise lands in the running tree's file for the checked-out issue,
// which the run's own commit carries.
describe('measure_rerun_cli.run — ledger location', () => {
	it('appends a refuted premise to the file the writer resolves for this tree', async () => {
		silence_console()
		const ledger_path = use_ledger('observations.md')

		mocked_issue_view.mockResolvedValue(issue_json(BODY, 'OWNER'))
		const code = await measure_rerun_cli.run(ISSUE, NOW)

		expect(code).toBe(0)
		expect(readFileSync(ledger_path, 'utf8')).toContain('echo hi')
		expect(observation_ledger_home.writer_path).toHaveBeenCalledWith(NOW)
		expect(mocked_issue_view).toHaveBeenCalledWith(ISSUE, expect.any(String))
	})
})

// joshuafolkken/kit#3064: the baseline is shell, so only a body whose author can write to the
// repository is run.
describe('measure_rerun_cli.run — author trust', () => {
	it('refuses a body written by a third party without running any command', async () => {
		silence_console()
		mocked_issue_view.mockResolvedValue(issue_json(BODY, 'NONE'))
		const code = await measure_rerun_cli.run(ISSUE, NOW)

		expect(code).toBe(1)
		expect(mocked_exec_sync).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('NONE'))
	})

	it('refuses when the issue cannot be read', async () => {
		silence_console()
		mocked_issue_view.mockResolvedValue(undefined)

		expect(await measure_rerun_cli.run(ISSUE, NOW)).toBe(1)
		expect(mocked_exec_sync).not.toHaveBeenCalled()
	})

	it('refuses an argument that is not an issue number', async () => {
		silence_console()

		expect(await measure_rerun_cli.run('issue-body.md', NOW)).toBe(1)
		expect(mocked_issue_view).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4037: `author_association` alone does not say "can write" — `COLLABORATOR`
// includes a read-only outside collaborator.
describe('measure_rerun_cli.run — write access', () => {
	it('refuses a body written by a collaborator with read access only', async () => {
		silence_console()
		use_asked_author(BODY, 'COLLABORATOR', 'reader', 'read')
		const code = await measure_rerun_cli.run(ISSUE, NOW)

		expect(code).toBe(1)
		expect(mocked_exec_sync).not.toHaveBeenCalled()
		expect(api_mock).toHaveBeenCalledWith({
			path: 'repos/{owner}/{repo}/collaborators/reader/permission',
		})
	})

	it('runs an OWNER body without asking for its author’s permission', async () => {
		silence_console()
		use_ledger('owner.md')
		mocked_issue_view.mockResolvedValue(issue_json(BODY, 'OWNER'))

		expect(await measure_rerun_cli.run(ISSUE, NOW)).toBe(0)
		expect(api_mock).not.toHaveBeenCalled()
	})
})

describe('measure_rerun_cli.run — command timeout', () => {
	it('prints a timed-out command as a failure and still runs the remaining baselines', async () => {
		const info = silence_console()

		use_ledger('timeout.md')
		use_asked_author(TWO_BASELINES, 'MEMBER', 'writer', 'write')
		mocked_exec_sync.mockImplementationOnce(() => {
			throw new Error(TIMEOUT_MESSAGE)
		})
		const code = await measure_rerun_cli.run(ISSUE, NOW)
		const printed = info.mock.calls.map((call) => String(call[0])).join('\n')

		expect(code).toBe(0)
		expect(mocked_exec_sync).toHaveBeenCalledWith(
			'sleep 999',
			expect.objectContaining({ timeout: expect.any(Number) as number }),
		)
		expect(printed).toContain(`(command failed: ${TIMEOUT_MESSAGE})`)
		expect(mocked_exec_sync).toHaveBeenCalledTimes(2)
	})
})
