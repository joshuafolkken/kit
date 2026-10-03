import { git_gh_exec, type GhApiRequest } from '#scripts/gh/git-gh-exec'
import { git_pr } from '#scripts/gh/git-pr'
import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { start_setup_pr } from './start-setup-pr'

vi.mock('execa', () => ({ execaSync: vi.fn() }))
vi.mock('#scripts/gh/git-pr', () => ({ git_pr: { create_with_issue_info: vi.fn() } }))

const ROOT = '/work/game'
const ISSUE_URL = 'https://github.com/owner/game/issues/7'
const BRANCH = '7-set-up-joshuafolkken-kit'
const KIT_PATHS = 'CLAUDE.md .github/workflows/ci.yml package.json .gitignore'
const COMMIT = `git commit --message Set up @joshuafolkken/kit #7 -- ${KIT_PATHS}`
const PUSH = `git push --set-upstream origin ${BRANCH}`
const READ_ONLY = ['git ls-files', 'git diff', 'git symbolic-ref', 'git rev-parse']
const PERSONAL_NOTE = 'employment-test.md'
const MANIFEST = 'package.json'
const EDITOR_DIRECTORY_FILE = '.serena/project.yml'
const UNTRACKED = ['CLAUDE.md', PERSONAL_NOTE, EDITOR_DIRECTORY_FILE, '.github/workflows/ci.yml']
const TOOLKIT_FILE = 'src/app.html'
const mocked_execa = vi.mocked(execaSync)

interface Tree {
	branch: string
	untracked: ReadonlyArray<string>
	modified: ReadonlyArray<string>
	open_issue: string
	has_branch: boolean
	staged: ReadonlyArray<string>
}

function result(stdout = '', exit_code = 0): ReturnType<typeof execaSync> {
	const value: unknown = { exitCode: exit_code, stdout }

	return value as ReturnType<typeof execaSync>
}

function command_of(call: ReadonlyArray<unknown>): string {
	const args: ReadonlyArray<unknown> = Array.isArray(call[1]) ? call[1] : []

	return [call[0], ...args].join(' ')
}

function git_writes(): Array<string> {
	return mocked_execa.mock.calls
		.map((call) => command_of(call))
		.filter((command) => READ_ONLY.every((prefix) => !command.startsWith(prefix)))
}

// What each read-only git subcommand answers for `tree`; `rev-parse` answers whether the branch exists.
function git_answer(subcommand: string, tree: Tree): ReturnType<typeof execaSync> {
	const listings: Readonly<Record<string, string>> = {
		'ls-files': tree.untracked.join('\0'),
		diff: tree.modified.join('\0'),
		staged: tree.staged.join('\0'),
		'symbolic-ref': tree.branch,
	}

	if (subcommand === 'rev-parse') return result('', tree.has_branch ? 0 : 1)

	return result(listings[subcommand] ?? '')
}

function subcommand_of(args: ReadonlyArray<string>): string {
	return args.includes('--cached') ? 'staged' : String(args[0])
}

// The working tree the reported onboarding left: kit's files beside a personal note and an editor's
// own directory, on main, with no setup Issue open yet.
function given(tree: Partial<Tree> = {}): void {
	const full: Tree = {
		branch: 'main',
		untracked: UNTRACKED,
		modified: [MANIFEST, '.gitignore'],
		open_issue: '',
		has_branch: false,
		staged: [],
		...tree,
	}

	mocked_execa.mockImplementation((_command, args) =>
		git_answer(Array.isArray(args) ? subcommand_of(args) : '', full),
	)
	vi.mocked(git_gh_exec.exec_gh_api_sync).mockImplementation((request: GhApiRequest) =>
		request.body === undefined ? full.open_issue : ISSUE_URL,
	)
}

function created_issue(): GhApiRequest | undefined {
	return vi
		.mocked(git_gh_exec.exec_gh_api_sync)
		.mock.calls.find((call) => call[0].body !== undefined)?.[0]
}

beforeEach(() => {
	mocked_execa.mockReset()
	vi.mocked(git_pr.create_with_issue_info).mockReset()
	vi.spyOn(git_gh_exec, 'exec_gh_api_sync').mockReset()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

describe('the setup pull request josh start opens (#2816)', () => {
	it('commits only the files kit wrote, naming them so nothing staged before rides along', async () => {
		given()
		await start_setup_pr.open(ROOT)

		expect(git_writes()).toStrictEqual([
			`git switch --create ${BRANCH}`,
			`git add -- ${KIT_PATHS}`,
			COMMIT,
			PUSH,
		])
	})

	it('files the Issue with a release classification', async () => {
		given()
		await start_setup_pr.open(ROOT)

		expect(created_issue()?.body).toContain('"labels":["ignore-for-release"]')
		expect(created_issue()?.body).toContain('Set up @joshuafolkken/kit')
	})

	it('opens the pull request for that Issue and merges nothing', async () => {
		given()
		await start_setup_pr.open(ROOT)

		expect(git_pr.create_with_issue_info).toHaveBeenCalledWith(
			expect.objectContaining({ number: '7', branch_name: BRANCH }),
		)
		expect(git_writes().some((command) => command.includes('merge'))).toBe(false)
	})

	it('files nothing and opens nothing when kit left no change', async () => {
		given({ untracked: [PERSONAL_NOTE], modified: [] })
		await start_setup_pr.open(ROOT)

		expect(git_gh_exec.exec_gh_api_sync).not.toHaveBeenCalled()
		expect(git_pr.create_with_issue_info).not.toHaveBeenCalled()
	})
})

describe('the setup pull request after a caller initialize command (#2872)', () => {
	it('also commits what changed since the baseline, leaving earlier changes out', async () => {
		given({ untracked: [...UNTRACKED, TOOLKIT_FILE] })
		await start_setup_pr.open(ROOT, [PERSONAL_NOTE, EDITOR_DIRECTORY_FILE])

		expect(git_writes()[1]).toBe(`git add -- ${KIT_PATHS} ${TOOLKIT_FILE}`)
	})

	it('commits only kit files without a baseline', async () => {
		given({ untracked: [...UNTRACKED, TOOLKIT_FILE] })
		await start_setup_pr.open(ROOT)

		expect(git_writes()[1]).toBe(`git add -- ${KIT_PATHS}`)
	})

	it('keeps the files a failed run staged on the setup branch when it resumes', async () => {
		given({
			branch: BRANCH,
			untracked: [PERSONAL_NOTE],
			modified: [TOOLKIT_FILE],
			staged: [TOOLKIT_FILE],
		})
		await start_setup_pr.open(ROOT, [PERSONAL_NOTE, TOOLKIT_FILE])

		expect(git_writes()[0]).toBe(`git add -- ${TOOLKIT_FILE}`)
	})

	it('reads listings NUL-separated so a non-ASCII name is committed unquoted', async () => {
		const non_ascii_file = 'src/日記.md'

		given({ untracked: [...UNTRACKED, non_ascii_file] })
		await start_setup_pr.open(ROOT, [])

		const listing_call = mocked_execa.mock.calls.find((call) =>
			command_of(call).includes('ls-files'),
		)

		expect(git_writes()[1]).toContain(non_ascii_file)
		expect(listing_call?.[1]).toContain('-z')
	})
})

describe('a re-run after the setup pull request failed part-way (#2816)', () => {
	it('reuses the setup Issue still open instead of filing a second one', async () => {
		given({ open_issue: '5' })
		await start_setup_pr.open(ROOT)

		expect(created_issue()).toBeUndefined()
		expect(git_writes()[0]).toBe('git switch --create 5-set-up-joshuafolkken-kit')
	})

	it('resumes on the setup branch a failed hook left, filing and switching nothing', async () => {
		given({ branch: BRANCH, untracked: [], modified: ['CLAUDE.md', MANIFEST] })
		await start_setup_pr.open(ROOT)

		expect(git_gh_exec.exec_gh_api_sync).not.toHaveBeenCalled()
		expect(git_writes()).toStrictEqual([
			'git add -- CLAUDE.md package.json',
			'git commit --message Set up @joshuafolkken/kit #7 -- CLAUDE.md package.json',
			PUSH,
		])
		expect(git_pr.create_with_issue_info).toHaveBeenCalled()
	})

	it('stops before switching when the setup branch already exists beside main', async () => {
		given({ open_issue: '7', has_branch: true })

		await expect(start_setup_pr.open(ROOT)).rejects.toThrow(`git switch ${BRANCH}`)
		expect(git_writes()).toStrictEqual([])
		expect(git_pr.create_with_issue_info).not.toHaveBeenCalled()
	})

	it('recognizes only the setup branch of its own title', () => {
		expect(start_setup_pr.is_setup_branch(BRANCH)).toBe(true)
		expect(start_setup_pr.is_setup_branch('7-add-score')).toBe(false)
		expect(start_setup_pr.is_setup_branch('main')).toBe(false)
		expect(start_setup_pr.is_setup_branch(undefined)).toBe(false)
	})
})
