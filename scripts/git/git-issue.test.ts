import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git_issue } from './git-issue'

const DARK_MODE_INPUT = 'Add dark mode #42'
const DARK_MODE_NUMBER = '42'
const DARK_MODE_TITLE = 'Add dark mode'
const DARK_MODE_BRANCH = '42-add-dark-mode'
const DERIVED_TITLE = 'add dark mode'
const NON_ISSUE_BRANCH = 'feature-branch'

vi.mock('./git-prompt', () => ({
	git_prompt: {
		get_issue_info: vi.fn(),
	},
}))

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(vi.fn())
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
	it('extracts issue number from the branch prefix', () => {
		const info = git_issue.derive_from_branch(DARK_MODE_BRANCH)

		expect(info.number).toBe(DARK_MODE_NUMBER)
	})

	it('de-slugs the branch into a spaced title', () => {
		const info = git_issue.derive_from_branch(DARK_MODE_BRANCH)

		expect(info.title).toBe(DERIVED_TITLE)
	})

	it('pins branch_name to the actual branch', () => {
		const info = git_issue.derive_from_branch(DARK_MODE_BRANCH)

		expect(info.branch_name).toBe(DARK_MODE_BRANCH)
	})

	it('formats commit message from the branch as "title #number"', () => {
		const info = git_issue.derive_from_branch(DARK_MODE_BRANCH)

		expect(info.commit_message).toBe(`${DERIVED_TITLE} #${DARK_MODE_NUMBER}`)
	})

	it('throws a clear error when the branch has no leading issue number', () => {
		expect(() => git_issue.derive_from_branch(NON_ISSUE_BRANCH)).toThrow(
			'Cannot derive issue info from branch',
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
