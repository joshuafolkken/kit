import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_error } from '#scripts/git/git-error'
import { afterEach, expect, it, vi } from 'vitest'
import { git_followup_finish } from './git-followup-finish'
import { git_pr_followup } from './git-pr-followup'

const PR_URL = vi.hoisted(() => 'https://github.com/owner/repo/pull/42')

vi.mock('node:util', async (import_original) => ({
	...(await import_original<Record<string, unknown>>()),
	parseArgs: vi.fn().mockReturnValue({ values: { merge: true }, positionals: ['6221'] }),
}))
vi.mock('#scripts/git/git-branch', () => ({
	git_branch: { current: vi.fn(async () => 'feature') },
}))
vi.mock('#scripts/git/git-error')
vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: {
		pr_get_url: vi.fn(async () => PR_URL),
		pr_get_merge_state: vi.fn(async () => ({ head_sha: 'head' })),
		label_ensure: vi.fn(),
		issue_add_label: vi.fn(async () => true),
		pr_merge: vi.fn(),
	},
}))
vi.mock('#scripts/gh/git-gh-pr-read', () => ({ require_pr_number: vi.fn(async () => 42) }))
vi.mock('#scripts/gh/git-gh-exec', () => ({
	git_gh_exec: {
		exec_gh_api: vi.fn(async (input: { path: string }) => {
			if (input.path === 'repos/{owner}/{repo}/pulls/42') {
				return '{"base":{"sha":"base"},"head":{"sha":"head"}}'
			}

			return '{"files":[{"filename":".github/workflows/ci.yml"}]}'
		}),
	},
}))
vi.mock('./git-followup-merged', () => ({
	git_followup_merged: {
		read_merge_plan: vi.fn(async () => ({ is_merged: false, should_merge: true })),
	},
}))
vi.mock('./followup-section')
vi.mock('./followup-review-gates')
vi.mock('#scripts/review/live-evidence')
vi.mock('#scripts/review/acceptance-map-check')
vi.mock('#scripts/review/removed-tests-check')
vi.mock('./git-followup-flush')
vi.mock('./git-followup-finish')
vi.mock('./git-pr-followup')

afterEach(() => vi.restoreAllMocks())

// joshuafolkken/kit#7312: the stop fires from `before_merge`, once the CI wait inside `run` is green.
it('ends --merge successfully with a URL and human action while leaving the PR open', async () => {
	const output = vi.spyOn(console, 'info').mockImplementation(() => undefined)

	vi.mocked(git_pr_followup.run).mockImplementation(async (input) => {
		await input.before_merge?.('head')

		return undefined
	})
	await import('./git-followup-workflow')
	await vi.waitFor(() => {
		expect(output).toHaveBeenCalledWith(expect.stringContaining('Read the diff on GitHub'))
	})
	expect(output).toHaveBeenCalledWith(expect.stringContaining(PR_URL))
	expect(git_gh_command.issue_add_label).toHaveBeenCalledOnce()
	expect(git_gh_command.pr_merge).not.toHaveBeenCalled()
	expect(git_pr_followup.run).toHaveBeenCalledOnce()
	expect(git_followup_finish.finish).not.toHaveBeenCalled()
	expect(git_error.handle).not.toHaveBeenCalled()
})
