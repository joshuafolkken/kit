import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git_issue } from './git-issue'

const DARK_MODE_INPUT = 'Add dark mode #42'
const DARK_MODE_NUMBER = '42'
const DARK_MODE_TITLE = 'Add dark mode'
const DARK_MODE_BRANCH = '42-add-dark-mode'
const DERIVED_TITLE = 'add dark mode'
const NON_ISSUE_BRANCH = 'feature-branch'

const LANE_NUMBER = '1465'
const LANE_BRANCH = '1465-lane'
const LANE_ISSUE_TITLE = 'Report the run as three nested windows'
const LANE_WORD = 'lane'

const issue_get_title_mock = vi.hoisted(() => vi.fn())

vi.mock('./git-gh-issue-read', () => ({
	git_gh_issue_read: {
		issue_get_title: issue_get_title_mock,
	},
}))

vi.mock('./git-prompt', () => ({
	git_prompt: {
		get_issue_info: vi.fn(),
	},
}))

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(vi.fn())
	issue_get_title_mock.mockReset()
	issue_get_title_mock.mockResolvedValue(LANE_ISSUE_TITLE)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('git_issue.get_and_display — parsing', () => {
	it('extracts issue number from input', async () => {
		const info = await git_issue.get_and_display(DARK_MODE_INPUT)

		expect(info.number).toBe(DARK_MODE_NUMBER)
	})

	it('extracts issue title from input', async () => {
		const info = await git_issue.get_and_display(DARK_MODE_INPUT)

		expect(info.title).toBe(DARK_MODE_TITLE)
	})

	it('builds kebab-case branch name', async () => {
		const info = await git_issue.get_and_display(DARK_MODE_INPUT)

		expect(info.branch_name).toBe(DARK_MODE_BRANCH)
	})

	it('formats commit message as "title #number"', async () => {
		const info = await git_issue.get_and_display(DARK_MODE_INPUT)

		expect(info.commit_message).toBe(DARK_MODE_INPUT)
	})

	it('normalizes unicode characters in branch name using NFKD decomposition', async () => {
		// cspell:disable-next-line
		const info = await git_issue.get_and_display('Ünïcödë title #7')

		expect(info.branch_name).toBe('7-u-ni-co-de-title')
	})

	it('falls back to "update" branch name when title normalizes to empty', async () => {
		const info = await git_issue.get_and_display('### #5')

		expect(info.branch_name).toBe('5-update')
	})
})

describe('git_issue.get_and_display — invalid input', () => {
	it('throws when issue number is missing', async () => {
		await expect(git_issue.get_and_display('No number here')).rejects.toThrow(
			'Issue number not found',
		)
	})

	it('throws when title is empty after stripping issue number', async () => {
		await expect(git_issue.get_and_display('#99')).rejects.toThrow('Issue title is required')
	})
})

describe('git_issue.derive_from_branch', () => {
	it('extracts issue number from the branch prefix', async () => {
		const info = await git_issue.derive_from_branch(DARK_MODE_BRANCH)

		expect(info.number).toBe(DARK_MODE_NUMBER)
	})

	it('de-slugs the branch into a spaced title', async () => {
		const info = await git_issue.derive_from_branch(DARK_MODE_BRANCH)

		expect(info.title).toBe(DERIVED_TITLE)
	})

	it('pins branch_name to the actual branch', async () => {
		const info = await git_issue.derive_from_branch(DARK_MODE_BRANCH)

		expect(info.branch_name).toBe(DARK_MODE_BRANCH)
	})

	it('formats commit message from the branch as "title #number"', async () => {
		const info = await git_issue.derive_from_branch(DARK_MODE_BRANCH)

		expect(info.commit_message).toBe(`${DERIVED_TITLE} #${DARK_MODE_NUMBER}`)
	})

	it('does not read the issue for a slug branch', async () => {
		await git_issue.derive_from_branch(DARK_MODE_BRANCH)

		expect(issue_get_title_mock).not.toHaveBeenCalled()
	})

	it('throws a clear error when the branch has no leading issue number', async () => {
		await expect(git_issue.derive_from_branch(NON_ISSUE_BRANCH)).rejects.toThrow(
			'Cannot derive issue info from branch',
		)
	})
})

describe('git_issue.derive_from_branch — lane branches', () => {
	it('reads the title from the issue named by the branch number', async () => {
		await git_issue.derive_from_branch(LANE_BRANCH)

		expect(issue_get_title_mock).toHaveBeenCalledWith(LANE_NUMBER)
	})

	it('uses the issue title rather than the branch word', async () => {
		const info = await git_issue.derive_from_branch(LANE_BRANCH)

		expect(info.title).toBe(LANE_ISSUE_TITLE)
	})

	it('never adopts "lane" as the commit message title', async () => {
		const info = await git_issue.derive_from_branch(LANE_BRANCH)

		expect(info.commit_message).toBe(`${LANE_ISSUE_TITLE} #${LANE_NUMBER}`)
		expect(info.title).not.toBe(LANE_WORD)
	})

	it('still takes the issue number from the branch', async () => {
		const info = await git_issue.derive_from_branch(LANE_BRANCH)

		expect(info.number).toBe(LANE_NUMBER)
	})
})

describe('git_issue.derive_from_branch — lane branch guards', () => {
	it('pins branch_name to the lane branch, leaving the issue-prefix guard intact', async () => {
		const info = await git_issue.derive_from_branch(LANE_BRANCH)

		expect(info.branch_name).toBe(LANE_BRANCH)
	})

	it('throws instead of falling back to "lane" when the title cannot be read', async () => {
		issue_get_title_mock.mockResolvedValue(undefined)

		await expect(git_issue.derive_from_branch(LANE_BRANCH)).rejects.toThrow(
			`Cannot read the title of issue #${LANE_NUMBER}`,
		)
	})
})

describe('git_issue.resolve_and_display', () => {
	it('parses cli_input when provided', async () => {
		const info = await git_issue.resolve_and_display({
			cli_input: DARK_MODE_INPUT,
			current_branch: NON_ISSUE_BRANCH,
			is_non_interactive: true,
		})

		expect(info.number).toBe(DARK_MODE_NUMBER)
	})

	it('derives from the branch when non-interactive and no cli_input, without prompting', async () => {
		const { git_prompt } = await import('./git-prompt')

		const info = await git_issue.resolve_and_display({
			cli_input: undefined,
			current_branch: DARK_MODE_BRANCH,
			is_non_interactive: true,
		})

		expect(info.title).toBe(DERIVED_TITLE)
		expect(vi.mocked(git_prompt.get_issue_info)).not.toHaveBeenCalled()
	})

	it('prompts interactively when not non-interactive and no cli_input', async () => {
		const { git_prompt } = await import('./git-prompt')

		vi.mocked(git_prompt.get_issue_info).mockResolvedValue(DARK_MODE_INPUT)

		const info = await git_issue.resolve_and_display({
			cli_input: undefined,
			current_branch: DARK_MODE_BRANCH,
			is_non_interactive: false,
		})

		expect(vi.mocked(git_prompt.get_issue_info)).toHaveBeenCalledOnce()
		expect(info.number).toBe(DARK_MODE_NUMBER)
	})
})

describe('git_issue.resolve_and_display — lane branches', () => {
	it('prefers an explicit cli_input over the lane branch, reading no issue', async () => {
		const info = await git_issue.resolve_and_display({
			cli_input: DARK_MODE_INPUT,
			current_branch: LANE_BRANCH,
			is_non_interactive: true,
		})

		expect(info.commit_message).toBe(DARK_MODE_INPUT)
		expect(issue_get_title_mock).not.toHaveBeenCalled()
	})
})
