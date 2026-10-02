import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { git_branch as real_git_branch } from './git-branch'

const current_branch = vi.hoisted(() => vi.fn<() => Promise<string>>())

vi.mock('./git-branch', async (import_original) => {
	const actual = await import_original<{ git_branch: typeof real_git_branch }>()

	return { git_branch: { ...actual.git_branch, current: current_branch } }
})

vi.mock('./git-command', () => ({
	git_command: {
		get_default_branch: vi.fn(),
		diff_main_names: vi.fn(),
		untracked_names: vi.fn(),
	},
}))

vi.mock('./git-gh-command', () => ({
	git_gh_command: {
		pr_exists: vi.fn(),
		pr_get_body: vi.fn(),
		issue_view_json: vi.fn(),
	},
}))

const { git_preflight } = await import('./git-preflight')
const { git_command } = await import('./git-command')
const { git_gh_command } = await import('./git-gh-command')

const UNCLASSIFIED_ISSUE = JSON.stringify({ labels: [], body: 'no classification here' })
const CLASSIFIED_ISSUE = JSON.stringify({ labels: [{ name: 'bug' }], body: '' })
const NUMBERED_BRANCH = '42-fix-login'
const UNNUMBERED_BRANCH = 'feature-login'
const NUMBERED_TITLE = 'fix login #42'

function arrange(branch: string, issue_json: string, changed_paths = 'README.md'): void {
	current_branch.mockResolvedValue(branch)
	vi.mocked(git_gh_command.issue_view_json).mockResolvedValue(issue_json)
	vi.mocked(git_command.diff_main_names).mockResolvedValue(changed_paths)
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(git_command.get_default_branch).mockResolvedValue('main')
	vi.mocked(git_gh_command.pr_exists).mockResolvedValue(false)
	vi.mocked(git_gh_command.pr_get_body).mockResolvedValue(undefined)
	vi.mocked(git_command.untracked_names).mockResolvedValue('')
})

describe('git_preflight.check — every unmet precondition in one report', () => {
	it('reports a branch without the issue number and an unclassified issue together', async () => {
		arrange(UNNUMBERED_BRANCH, UNCLASSIFIED_ISSUE)

		const result = git_preflight.check({ cli_input: NUMBERED_TITLE, will_open_pr: true })

		await expect(result).rejects.toThrow(/2 unmet precondition\(s\)/u)
		await expect(result).rejects.toThrow(/Branch mismatch: on "feature-login"/u)
		await expect(result).rejects.toThrow(/Choose one release classification/u)
	})

	it('reports a title without an issue number', async () => {
		arrange(UNNUMBERED_BRANCH, CLASSIFIED_ISSUE)

		const result = git_preflight.check({ cli_input: 'fix login', will_open_pr: true })

		await expect(result).rejects.toThrow(/Issue number not found/u)
	})

	it('reports a branch the issue cannot be derived from when no title is given', async () => {
		arrange(UNNUMBERED_BRANCH, CLASSIFIED_ISSUE)

		const result = git_preflight.check({ cli_input: undefined, will_open_pr: true })

		await expect(result).rejects.toThrow(/Cannot derive issue info from branch "feature-login"/u)
	})
})

describe('git_preflight.check — when every precondition holds', () => {
	it('resolves on a numbered branch whose issue is classified', async () => {
		arrange(NUMBERED_BRANCH, CLASSIFIED_ISSUE)

		await expect(
			git_preflight.check({ cli_input: undefined, will_open_pr: true }),
		).resolves.toBeUndefined()
		expect(git_gh_command.issue_view_json).toHaveBeenCalledWith('42', 'labels,body')
	})

	it('accepts a title on the default branch, where the branch is still to be created', async () => {
		arrange('main', CLASSIFIED_ISSUE)

		await expect(
			git_preflight.check({ cli_input: NUMBERED_TITLE, will_open_pr: true }),
		).resolves.toBeUndefined()
	})

	it('does not read the classification when no pull request will be opened', async () => {
		arrange(NUMBERED_BRANCH, UNCLASSIFIED_ISSUE)

		await expect(
			git_preflight.check({ cli_input: undefined, will_open_pr: false }),
		).resolves.toBeUndefined()
		expect(git_gh_command.issue_view_json).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#2946: `josh ship` asks the same preconditions before its review and gate.
describe('git_preflight.problems_of — the refusal as a list', () => {
	it('lists every unmet precondition the check refuses on, without throwing', async () => {
		arrange(UNNUMBERED_BRANCH, UNCLASSIFIED_ISSUE)

		const problems = await git_preflight.problems_of({
			cli_input: NUMBERED_TITLE,
			will_open_pr: true,
		})

		expect(problems).toHaveLength(2)
		expect(problems[0]).toMatch(/Branch mismatch/u)
		expect(problems[1]).toMatch(/Choose one release classification/u)
	})

	it('is empty when every precondition holds', async () => {
		arrange(NUMBERED_BRANCH, CLASSIFIED_ISSUE)

		expect(
			await git_preflight.problems_of({ cli_input: undefined, will_open_pr: true }),
		).toStrictEqual([])
	})
})

describe('git_preflight.check — live-evidence notice', () => {
	it('announces the evidence section for a runtime change', async () => {
		arrange(NUMBERED_BRANCH, CLASSIFIED_ISSUE, 'scripts/git/git-pr.ts')
		const info = vi.spyOn(console, 'info').mockReturnValue(undefined)

		await git_preflight.check({ cli_input: undefined, will_open_pr: true })

		expect(info).toHaveBeenCalledWith(expect.stringContaining('## 実機証跡'))
		info.mockRestore()
	})

	it('announces the evidence section for a runtime file that is still untracked', async () => {
		arrange(NUMBERED_BRANCH, CLASSIFIED_ISSUE, '')
		vi.mocked(git_command.untracked_names).mockResolvedValue('scripts/git/new-thing.ts')
		const info = vi.spyOn(console, 'info').mockReturnValue(undefined)

		await git_preflight.check({ cli_input: undefined, will_open_pr: true })

		expect(info).toHaveBeenCalledWith(expect.stringContaining('## 実機証跡'))
		info.mockRestore()
	})

	it('stays quiet for a change that needs no evidence', async () => {
		arrange(NUMBERED_BRANCH, CLASSIFIED_ISSUE)
		const info = vi.spyOn(console, 'info').mockReturnValue(undefined)

		await git_preflight.check({ cli_input: undefined, will_open_pr: true })

		expect(info).not.toHaveBeenCalled()
		info.mockRestore()
	})
})
