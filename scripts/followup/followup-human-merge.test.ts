import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { require_pr_number } from '#scripts/gh/git-gh-pr-read'
import { NEEDS_HUMAN_MERGE_LABEL } from '#scripts/issue/issue-labels'
import { beforeEach, expect, it, vi } from 'vitest'
import { followup_human_merge, HumanMergeRequiredError } from './followup-human-merge'

vi.mock('#scripts/gh/git-gh-command')
vi.mock('#scripts/gh/git-gh-exec')
vi.mock('#scripts/gh/git-gh-pr-read')

const BRANCH = 'feature'
const ISSUE = '6221'
const PR = 42
const URL = 'https://github.com/owner/repo/pull/42'
const WORKFLOW = '.github/workflows/ci.yml'
const SOURCE = 'src/main.ts'
const HEAD = 'checked-head'
const BASE = 'base-head'
const PULL = JSON.stringify({ base: { sha: BASE }, head: { sha: HEAD } })
const REPO_PATH = 'repos/{owner}/{repo}'
const PULL_PATH = `${REPO_PATH}/pulls/42`
const COMPARISON_PATH = `${REPO_PATH}/compare/${BASE}...${HEAD}?per_page=1`
const HEAD_CHANGED = 'head changed'
const API_FAILURE = 'API unavailable'

function mock_files(raw: string): void {
	vi.mocked(git_gh_exec.exec_gh_api).mockImplementation(async (input) => {
		if (input.path === PULL_PATH) return PULL

		return raw
	})
}

beforeEach(() => {
	vi.resetAllMocks()
	vi.mocked(require_pr_number).mockResolvedValue(PR)
	mock_files('{"files":[]}')
	vi.mocked(git_gh_command.pr_get_url).mockResolvedValue(URL)
	vi.mocked(git_gh_command.issue_add_label).mockResolvedValue(true)
})

it.each([
	[{ filename: WORKFLOW }],
	[{ filename: SOURCE }, { filename: WORKFLOW }],
	[{ filename: SOURCE, previous_filename: WORKFLOW }],
	[{ filename: WORKFLOW, previous_filename: SOURCE }],
])('requires a human for workflow paths on either side: %j', async (...files) => {
	mock_files(JSON.stringify({ files }))

	await expect(followup_human_merge.assert_allowed(BRANCH, ISSUE)).rejects.toThrow(
		HumanMergeRequiredError,
	)
	expect(git_gh_command.label_ensure).toHaveBeenCalledWith(
		expect.objectContaining({ name: NEEDS_HUMAN_MERGE_LABEL }),
	)
	expect(git_gh_command.issue_add_label).toHaveBeenCalledWith(ISSUE, NEEDS_HUMAN_MERGE_LABEL)
})

it('prints the PR URL and manual next action through the successful stop', async () => {
	mock_files(JSON.stringify({ files: [{ filename: WORKFLOW }] }))

	await expect(followup_human_merge.assert_allowed(BRANCH, ISSUE)).rejects.toThrow(
		`${URL}\nRead the diff on GitHub and merge the pull request there.`,
	)
})

it.each([[], [{ filename: SOURCE }], [{ filename: '.github/workflows-other/ci.yml' }]])(
	'allows a complete PR without workflow changes: %j',
	async (...files) => {
		mock_files(JSON.stringify({ files }))

		await expect(followup_human_merge.assert_allowed(BRANCH, ISSUE)).resolves.toBeUndefined()
		expect(git_gh_command.issue_add_label).not.toHaveBeenCalled()
		expect(git_gh_exec.exec_gh_api).toHaveBeenCalledWith({
			path: COMPARISON_PATH,
		})
	},
)

it.each(['not JSON', '{}', '[{}]'])('refuses an unreadable file listing: %s', async (raw) => {
	mock_files(raw)

	await expect(followup_human_merge.assert_allowed(BRANCH, ISSUE)).rejects.toThrow('complete')
})

it('refuses a truncated listing at the GitHub file limit', async () => {
	const file_limit = 300

	mock_files(
		JSON.stringify({ files: Array.from({ length: file_limit }, () => ({ filename: SOURCE })) }),
	)

	await expect(followup_human_merge.assert_allowed(BRANCH, ISSUE)).rejects.toThrow('complete')
})

it('propagates API failures instead of authorizing the merge', async () => {
	vi.mocked(git_gh_exec.exec_gh_api).mockRejectedValue(new Error(API_FAILURE))

	await expect(followup_human_merge.assert_allowed(BRANCH, ISSUE)).rejects.toThrow(API_FAILURE)
})

it('uses the PR closing Issue when none was passed', async () => {
	mock_files(JSON.stringify({ files: [{ filename: WORKFLOW }] }))
	vi.mocked(git_gh_command.pr_get_body).mockResolvedValue(`closes #${ISSUE}`)

	await expect(followup_human_merge.assert_allowed(BRANCH, undefined)).rejects.toThrow(
		HumanMergeRequiredError,
	)
	expect(git_gh_command.issue_add_label).toHaveBeenCalledWith(ISSUE, NEEDS_HUMAN_MERGE_LABEL)
})

it('does not silently lose a failed label application', async () => {
	mock_files(JSON.stringify({ files: [{ filename: WORKFLOW }] }))
	vi.mocked(git_gh_command.issue_add_label).mockResolvedValue(false)

	await expect(followup_human_merge.assert_allowed(BRANCH, ISSUE)).rejects.toThrow(
		'Could not label',
	)
})

it('refuses a head change during the file read', async () => {
	vi.mocked(git_gh_command.pr_get_merge_state).mockResolvedValue({
		is_merged: false,
		merged_at: undefined,
		head_sha: 'new-head',
		merge_state_status: undefined,
	})

	await expect(followup_human_merge.assert_allowed(BRANCH, ISSUE, HEAD)).rejects.toThrow(
		HEAD_CHANGED,
	)
})

it('allows the exact checked head when its complete diff has no workflow', async () => {
	vi.mocked(git_gh_command.pr_get_merge_state).mockResolvedValue({
		is_merged: false,
		merged_at: undefined,
		head_sha: HEAD,
		merge_state_status: undefined,
	})

	await expect(followup_human_merge.assert_allowed(BRANCH, ISSUE, HEAD)).resolves.toBeUndefined()
})

it('checks the immutable head diff when the PR moves away and back during its read', async () => {
	vi.mocked(git_gh_exec.exec_gh_api).mockImplementation(async (input) => {
		if (input.path === PULL_PATH) return PULL
		if (input.path === COMPARISON_PATH) return JSON.stringify({ files: [{ filename: WORKFLOW }] })

		return '[]'
	})
	vi.mocked(git_gh_command.pr_get_merge_state).mockResolvedValue({
		is_merged: false,
		merged_at: undefined,
		head_sha: HEAD,
		merge_state_status: undefined,
	})

	await expect(followup_human_merge.assert_allowed(BRANCH, ISSUE, HEAD)).rejects.toThrow(
		HumanMergeRequiredError,
	)
	expect(git_gh_exec.exec_gh_api).toHaveBeenCalledWith({ path: COMPARISON_PATH })
})

it('refuses a PR snapshot that does not match the checked head', async () => {
	await expect(followup_human_merge.assert_allowed(BRANCH, ISSUE, 'another-head')).rejects.toThrow(
		HEAD_CHANGED,
	)
	expect(git_gh_exec.exec_gh_api).toHaveBeenCalledOnce()
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
