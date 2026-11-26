import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_preflight, type ChildState, type TreeState } from './run-preflight'

vi.mock('#scripts/git/git-command', () => ({
	git_command: {
		branch: vi.fn(),
		branch_names: vi.fn(),
		branch_names_remote: vi.fn(),
		commit_count_beyond: vi.fn(),
		default_branch_reference: vi.fn(),
		get_default_branch: vi.fn(),
	},
}))

vi.mock('#scripts/git/stash/git-stash', () => ({
	git_stash: { has_stashable_changes: vi.fn() },
}))

vi.mock('#scripts/gh/git-gh-pr-read', () => ({
	git_gh_pr_read: { pr_exists: vi.fn(), pr_view: vi.fn() },
}))

vi.mock('#scripts/lane/lane-registry', () => ({
	lane_registry: { find_open_lane: vi.fn() },
}))

vi.mock('#scripts/lane/lane-state', () => ({ lane_state: { read_state: vi.fn() } }))

const { git_command } = await import('#scripts/git/git-command')
const { git_stash } = await import('#scripts/git/stash/git-stash')

const branch = vi.mocked(git_command.branch)
const branch_names = vi.mocked(git_command.branch_names)
const branch_names_remote = vi.mocked(git_command.branch_names_remote)
const commit_count_beyond = vi.mocked(git_command.commit_count_beyond)
const default_branch_reference = vi.mocked(git_command.default_branch_reference)
const default_branch = vi.mocked(git_command.get_default_branch)
const has_stashable_changes = vi.mocked(git_stash.has_stashable_changes)

const ISSUE = '926'
const OTHER_ISSUE_BRANCH = '927-create-the-issue-branch'
const MAIN = 'main'
const NO_WORK: ChildState = { branch_name: undefined, pr_state: 'none' }
const ON_OTHER_BRANCH: TreeState = {
	branch: OTHER_ISSUE_BRANCH,
	default_branch: MAIN,
	is_dirty: false,
}

function arrange_other_issue_branch(commits: number): void {
	has_stashable_changes.mockResolvedValue(false)
	branch.mockResolvedValue(OTHER_ISSUE_BRANCH)
	default_branch.mockResolvedValue(MAIN)
	default_branch_reference.mockResolvedValue(`origin/${MAIN}`)
	branch_names.mockResolvedValue([])
	branch_names_remote.mockResolvedValue([])
	commit_count_beyond.mockResolvedValue(commits)
}

async function verdict_from_check(): Promise<string> {
	const decision = await run_preflight.check(ISSUE)

	return decision.verdict
}

afterEach(() => {
	vi.resetAllMocks()
})

// joshuafolkken/kit#8983: `run:entry` switches to `<N>-<slug>` after the sync, so an entry that stops
// later leaves a branch with nothing on it — the next entry for another issue starts, not reclaims.
describe('check reads a bare issue branch as standing on the default branch', () => {
	it('answers clean for another issue’s branch with no commit beyond the default branch', async () => {
		arrange_other_issue_branch(0)

		expect(await verdict_from_check()).toBe('clean')
		expect(commit_count_beyond).toHaveBeenCalledWith(`origin/${MAIN}`, 'HEAD')
	})

	it('still reclaims another issue’s branch that holds commits', async () => {
		arrange_other_issue_branch(1)

		expect(await verdict_from_check()).toBe('reclaim')
	})

	it('still reclaims when the commit count cannot be read', async () => {
		arrange_other_issue_branch(0)
		commit_count_beyond.mockRejectedValue(new Error('no origin'))

		expect(await verdict_from_check()).toBe('reclaim')
	})

	it('still reclaims a dirty bare branch without counting its commits', async () => {
		arrange_other_issue_branch(0)
		has_stashable_changes.mockResolvedValue(true)

		expect(await verdict_from_check()).toBe('reclaim')
		expect(commit_count_beyond).not.toHaveBeenCalled()
	})
})

describe('decide treats a bare tree as the default branch', () => {
	it('answers clean with the clean advice', () => {
		const decision = run_preflight.decide({ ...ON_OTHER_BRANCH, is_bare: true }, NO_WORK, ISSUE)

		expect(decision.verdict).toBe('clean')
		expect(decision.advice).toBe('Start the child.')
	})

	it('reclaims the same tree when it is not bare', () => {
		expect(run_preflight.decide(ON_OTHER_BRANCH, NO_WORK, ISSUE).verdict).toBe('reclaim')
	})
})
