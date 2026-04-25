import { beforeEach, describe, expect, it, vi } from 'vitest'

const ISSUE_INPUT = vi.hoisted(() => 'feat: add login #42')
const FAKE_BRANCH_NAME = vi.hoisted(() => '42-fake-title')
const FAKE_ISSUE_COMMIT = vi.hoisted(() => 'fake title #42')
const ALT_BRANCH_NAME = '42-short-name'

vi.mock('node:util', () => ({
	parseArgs: vi.fn().mockReturnValue({ values: {}, positionals: [] }),
}))

vi.mock('../scripts/git/git-staging', () => ({
	git_staging: { check_and_confirm_staging: vi.fn<() => Promise<void>>().mockResolvedValue() },
}))

vi.mock('../scripts/git/git-branch', () => ({
	git_branch: {
		current: vi.fn().mockResolvedValue('feature-branch'),
		check_and_create_branch: vi.fn<() => Promise<string>>().mockResolvedValue(FAKE_BRANCH_NAME),
	},
}))

vi.mock('../scripts/git/git-issue', () => ({
	git_issue: {
		get_and_display: vi.fn().mockResolvedValue({
			title: 'fake title',
			number: '42',
			branch_name: FAKE_BRANCH_NAME,
			commit_message: FAKE_ISSUE_COMMIT,
		}),
	},
}))

vi.mock('../scripts/git/git-prompt', () => ({
	git_prompt: {
		confirm_workflow_steps: vi.fn().mockResolvedValue({ commit: false, push: false, pr: false }),
		get_issue_info: vi.fn().mockResolvedValue('fake #42'),
	},
}))

vi.mock('../scripts/git/git-commit', () => ({ git_commit: { commit: vi.fn() } }))
vi.mock('../scripts/git/git-push', () => ({ git_push: { push: vi.fn() } }))
vi.mock('../scripts/git/git-pr', () => ({ git_pr: { create_with_issue_info: vi.fn() } }))
vi.mock('../scripts/git/git-error', () => ({ git_error: { handle: vi.fn() } }))

const { git_workflow } = await import('./git-workflow')

beforeEach(() => {
	vi.clearAllMocks()
})

describe('parse_positionals', () => {
	it('returns undefined and is_auto_mode=false when positionals is empty', () => {
		const result = git_workflow.parse_positionals([])

		expect(result).toStrictEqual({
			cli_issue_input: undefined,
			is_auto_mode: false,
			commit_suffix: undefined,
		})
	})

	it('returns issue input and is_auto_mode=true for single positional', () => {
		const result = git_workflow.parse_positionals([ISSUE_INPUT])

		expect(result).toStrictEqual({
			cli_issue_input: ISSUE_INPUT,
			is_auto_mode: true,
			commit_suffix: undefined,
		})
	})

	it('joins extra positionals as commit_suffix', () => {
		const result = git_workflow.parse_positionals([ISSUE_INPUT, 'fix', 'ci'])

		expect(result).toStrictEqual({
			cli_issue_input: ISSUE_INPUT,
			is_auto_mode: true,
			commit_suffix: 'fix ci',
		})
	})

	it('uses single extra positional as commit_suffix', () => {
		const result = git_workflow.parse_positionals([ISSUE_INPUT, 'fix-ci'])

		expect(result.commit_suffix).toBe('fix-ci')
	})
})

describe('get_workflow_confirmations — auto mode skip flags', () => {
	it('returns all true when is_auto_mode=true and no skip flags', async () => {
		const result = await git_workflow.get_workflow_confirmations(true, {})

		expect(result).toStrictEqual({ commit: true, push: true, pr: true })
	})

	it('returns commit=false when skip-commit is true', async () => {
		const result = await git_workflow.get_workflow_confirmations(true, {
			'skip-commit': true,
		})

		expect(result).toStrictEqual({ commit: false, push: true, pr: true })
	})

	it('returns push=false when skip-push is true', async () => {
		const result = await git_workflow.get_workflow_confirmations(true, { 'skip-push': true })

		expect(result).toStrictEqual({ commit: true, push: false, pr: true })
	})

	it('returns pr=false when skip-pr is true', async () => {
		const result = await git_workflow.get_workflow_confirmations(true, { 'skip-pr': true })

		expect(result).toStrictEqual({ commit: true, push: true, pr: false })
	})
})

describe('get_workflow_confirmations — interactive mode', () => {
	it('calls confirm_workflow_steps when is_auto_mode=false', async () => {
		const { git_prompt } = await import('../scripts/git/git-prompt')

		await git_workflow.get_workflow_confirmations(false, {})

		expect(vi.mocked(git_prompt.confirm_workflow_steps)).toHaveBeenCalledOnce()
	})
})

describe('get_workflow_confirmations — body flag is separate from confirmations', () => {
	it('does not affect confirmations when body is provided', async () => {
		const result = await git_workflow.get_workflow_confirmations(true, { body: 'my pr body' })

		expect(result).toStrictEqual({ commit: true, push: true, pr: true })
	})
})

describe('prepare_issue_info — branch name override', () => {
	it('returns issue_info with branch_name from check_and_create_branch', async () => {
		const { git_branch } = await import('../scripts/git/git-branch')

		vi.mocked(git_branch.check_and_create_branch).mockResolvedValue(FAKE_BRANCH_NAME)

		const result = await git_workflow.prepare_issue_info(FAKE_ISSUE_COMMIT)

		expect(result.branch_name).toBe(FAKE_BRANCH_NAME)
	})

	it('overrides generated branch_name when check_and_create_branch returns different value', async () => {
		const { git_branch } = await import('../scripts/git/git-branch')

		vi.mocked(git_branch.check_and_create_branch).mockResolvedValue(ALT_BRANCH_NAME)

		const result = await git_workflow.prepare_issue_info(FAKE_ISSUE_COMMIT)

		expect(result.branch_name).toBe(ALT_BRANCH_NAME)
	})
})
