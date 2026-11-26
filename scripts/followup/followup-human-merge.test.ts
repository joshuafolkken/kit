import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { require_pr_number } from '#scripts/gh/git-gh-pr-read'
import { git_spawn } from '#scripts/git/git-spawn'
import { NEEDS_HUMAN_MERGE_LABEL } from '#scripts/issue/issue-labels'
import { beforeEach, expect, it, vi } from 'vitest'
import { followup_human_merge, HumanMergeRequiredError } from './followup-human-merge'

vi.mock('#scripts/gh/git-gh-command')
vi.mock('#scripts/gh/git-gh-exec')
vi.mock('#scripts/gh/git-gh-pr-read')
vi.mock('#scripts/git/git-spawn')

const BRANCH = 'feature'
const ISSUE = '6221'
const PR = 42
const URL = 'https://github.com/owner/repo/pull/42'
const WORKFLOW = '.github/workflows/ci.yml'
const SOURCE = 'src/main.ts'
const HEAD = 'checked-head'
const BASE = 'base-head'
const PULL = JSON.stringify({ base: { sha: BASE }, head: { sha: HEAD } })
const DIFF = ['diff', '--name-only', '--no-renames', '--no-relative', '-z', `${BASE}...${HEAD}`]
const FETCH = ['fetch', '--no-tags', 'origin', BASE, HEAD]
const HEAD_CHANGED = 'head changed'
const API_FAILURE = 'API unavailable'
const GIT_FAILURE = 'git unavailable'
// GitHub's comparison listing stops at 300 files; the listing has to see past it.
const PAST_COMPARISON_LIMIT = 534

function mock_paths(paths: Array<string>): void {
	vi.mocked(git_spawn.read).mockResolvedValue(paths.map((path) => `${path}\0`).join(''))
}

function many_sources(count: number): Array<string> {
	return Array.from({ length: count }, (_, index) => `src/file-${String(index)}.ts`)
}

function mock_head(head_sha: string): void {
	vi.mocked(git_gh_command.pr_get_merge_state).mockResolvedValue({
		is_merged: false,
		merged_at: undefined,
		head_sha,
		merge_state_status: undefined,
	})
}

beforeEach(() => {
	vi.resetAllMocks()
	vi.mocked(require_pr_number).mockResolvedValue(PR)
	vi.mocked(git_gh_exec.exec_gh_api).mockResolvedValue(PULL)
	mock_paths([])
	vi.mocked(git_gh_command.pr_get_url).mockResolvedValue(URL)
	vi.mocked(git_gh_command.issue_add_label).mockResolvedValue(true)
})

it.each([[[WORKFLOW]], [[SOURCE, WORKFLOW]], [[...many_sources(PAST_COMPARISON_LIMIT), WORKFLOW]]])(
	'requires a human for a workflow path anywhere in the diff: %#',
	async (paths) => {
		mock_paths(paths)

		await expect(followup_human_merge.assert_allowed(BRANCH, ISSUE)).rejects.toThrow(
			HumanMergeRequiredError,
		)
		expect(git_gh_command.label_ensure).toHaveBeenCalledWith(
			expect.objectContaining({ name: NEEDS_HUMAN_MERGE_LABEL }),
		)
		expect(git_gh_command.issue_add_label).toHaveBeenCalledWith(ISSUE, NEEDS_HUMAN_MERGE_LABEL)
	},
)

it('prints the PR URL and manual next action through the successful stop', async () => {
	mock_paths([WORKFLOW])

	await expect(followup_human_merge.assert_allowed(BRANCH, ISSUE)).rejects.toThrow(
		`${URL}\nRead the diff on GitHub and merge the pull request there.`,
	)
})

it.each([
	[[]],
	[[SOURCE]],
	[['.github/workflows-other/ci.yml']],
	[many_sources(PAST_COMPARISON_LIMIT)],
])('allows a PR without workflow changes, whatever its size: %#', async (paths) => {
	mock_paths(paths)

	await expect(followup_human_merge.assert_allowed(BRANCH, ISSUE)).resolves.toBeUndefined()
	expect(git_gh_command.issue_add_label).not.toHaveBeenCalled()
	expect(git_spawn.read_remote).toHaveBeenCalledWith(FETCH)
	expect(git_spawn.read).toHaveBeenCalledWith(DIFF)
})

it.each([
	['fetch', git_spawn.read_remote],
	['diff', git_spawn.read],
])('refuses a merge when the %s of the complete listing fails', async (_, step) => {
	vi.mocked(step).mockRejectedValue(new Error(GIT_FAILURE))

	await expect(followup_human_merge.assert_allowed(BRANCH, ISSUE)).rejects.toThrow(GIT_FAILURE)
	expect(git_gh_command.issue_add_label).not.toHaveBeenCalled()
})

it('propagates API failures instead of authorizing the merge', async () => {
	vi.mocked(git_gh_exec.exec_gh_api).mockRejectedValue(new Error(API_FAILURE))

	await expect(followup_human_merge.assert_allowed(BRANCH, ISSUE)).rejects.toThrow(API_FAILURE)
})

it('uses the PR closing Issue when none was passed', async () => {
	mock_paths([WORKFLOW])
	vi.mocked(git_gh_command.pr_get_body).mockResolvedValue(`closes #${ISSUE}`)

	await expect(followup_human_merge.assert_allowed(BRANCH, undefined)).rejects.toThrow(
		HumanMergeRequiredError,
	)
	expect(git_gh_command.issue_add_label).toHaveBeenCalledWith(ISSUE, NEEDS_HUMAN_MERGE_LABEL)
})

it('does not silently lose a failed label application', async () => {
	mock_paths([WORKFLOW])
	vi.mocked(git_gh_command.issue_add_label).mockResolvedValue(false)

	await expect(followup_human_merge.assert_allowed(BRANCH, ISSUE)).rejects.toThrow(
		'Could not label',
	)
})

it('refuses a head change during the file read', async () => {
	mock_head('new-head')

	await expect(followup_human_merge.assert_allowed(BRANCH, ISSUE, HEAD)).rejects.toThrow(
		HEAD_CHANGED,
	)
})

it('allows the exact checked head when its complete diff has no workflow', async () => {
	mock_head(HEAD)

	await expect(followup_human_merge.assert_allowed(BRANCH, ISSUE, HEAD)).resolves.toBeUndefined()
})

it('checks the immutable head diff when the PR moves away and back during its read', async () => {
	mock_paths([WORKFLOW])
	mock_head(HEAD)

	await expect(followup_human_merge.assert_allowed(BRANCH, ISSUE, HEAD)).rejects.toThrow(
		HumanMergeRequiredError,
	)
	expect(git_spawn.read).toHaveBeenCalledWith(DIFF)
})

it('refuses a PR snapshot that does not match the checked head', async () => {
	await expect(followup_human_merge.assert_allowed(BRANCH, ISSUE, 'another-head')).rejects.toThrow(
		HEAD_CHANGED,
	)
	expect(git_gh_exec.exec_gh_api).toHaveBeenCalledOnce()
	expect(git_spawn.read).not.toHaveBeenCalled()
})

it.each(['not JSON', '{}', '{"base":{"sha":""},"head":{"sha":""}}'])(
	'refuses unreadable comparison commits: %s',
	async (raw) => {
		vi.mocked(git_gh_exec.exec_gh_api).mockResolvedValue(raw)

		await expect(followup_human_merge.assert_allowed(BRANCH, ISSUE)).rejects.toThrow(
			'comparison commits',
		)
	},
)
