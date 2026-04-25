import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git_issue } from './git-issue'

const DARK_MODE_INPUT = 'Add dark mode #42'
const DARK_MODE_NUMBER = '42'
const DARK_MODE_TITLE = 'Add dark mode'
const DARK_MODE_BRANCH = '42-add-dark-mode'

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
