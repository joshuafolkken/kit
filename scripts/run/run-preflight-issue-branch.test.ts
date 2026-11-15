import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	run_preflight,
	type ChildState,
	type PreflightVerdict,
	type PrState,
	type TreeState,
} from './run-preflight'

// joshuafolkken/kit#7543: an issue whose open pull request was returned could not be resumed —
// its own branch answered `reclaim`, and the default branch answered `resume` without a hold, so
// following either answer led back to the other.
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

const { git_command } = await import('#scripts/git/git-command')
const { git_stash } = await import('#scripts/git/stash/git-stash')
const { git_gh_pr_read } = await import('#scripts/gh/git-gh-pr-read')

const ISSUE = '926'
const ISSUE_BRANCH = '926-x'
const MAIN = 'main'
const ON_MAIN: TreeState = { branch: MAIN, default_branch: MAIN, is_dirty: false }
const ON_ISSUE_BRANCH: TreeState = { ...ON_MAIN, branch: ISSUE_BRANCH }
const NO_WORK: ChildState = { branch_name: undefined, pr_state: 'none' }
const OPEN_ON_BRANCH: ChildState = { branch_name: ISSUE_BRANCH, pr_state: 'open' }

function verdict_of(tree: TreeState, state: ChildState): PreflightVerdict {
	return run_preflight.decide(tree, state, ISSUE).verdict
}

function on_branch(pr_state: PrState): ChildState {
	return { branch_name: ISSUE_BRANCH, pr_state }
}

afterEach(() => {
	vi.resetAllMocks()
})

describe('a clean tree on this issue’s own branch takes the hold', () => {
	it.each([
		['an open pull request', on_branch('open'), 'clean'],
		['commits with no pull request yet', on_branch('none'), 'clean'],
		['a merged pull request', on_branch('merged'), 'park'],
		['a closed pull request', on_branch('closed'), 'park'],
	])('%s answers %j', (_name, state, expected) => {
		expect(verdict_of(ON_ISSUE_BRANCH, state)).toBe(expected)
	})

	it('still requires the whole verification gate there', () => {
		const decision = run_preflight.decide(ON_ISSUE_BRANCH, OPEN_ON_BRANCH, ISSUE)

		expect(decision.advice).toBe(run_preflight.RESUME_ADVICE)
		expect(decision.reason).toContain('own branch')
	})
})

describe('another issue’s branch or uncommitted changes still reclaim', () => {
	it.each([
		['another issue’s branch', { ...ON_MAIN, branch: '927-x' }],
		['a number that merely starts the same', { ...ON_MAIN, branch: '9261-x' }],
		['a dirty tree on this issue’s branch', { ...ON_ISSUE_BRANCH, is_dirty: true }],
	])('%s answers reclaim', (_name, tree) => {
		expect(verdict_of(tree, NO_WORK)).toBe('reclaim')
	})
})

describe('from the default branch, resume names the one command that leads to a hold', () => {
	it('switches onto the branch, then asks again', () => {
		const decision = run_preflight.decide(ON_MAIN, OPEN_ON_BRANCH, ISSUE)

		expect(decision.verdict).toBe('resume')
		expect(decision.advice).toContain(`git switch ${ISSUE_BRANCH}`)
		expect(decision.advice).not.toContain('pnpm josh ms')
	})

	it('answers clean once the switch is made, so resume and reclaim never alternate', () => {
		expect(verdict_of(ON_ISSUE_BRANCH, OPEN_ON_BRANCH)).toBe('clean')
	})

	it('resumes onto the sibling branch that holds the open pull request', () => {
		const sibling: ChildState = { branch_name: '926-retry', pr_state: 'open' }
		const decision = run_preflight.decide(ON_ISSUE_BRANCH, sibling, ISSUE)

		expect(decision.verdict).toBe('resume')
		expect(decision.advice).toContain('git switch 926-retry')
	})

	it('quotes a branch name so shell metacharacters stay one argument', () => {
		const odd: ChildState = { branch_name: '926-a;b', pr_state: 'open' }

		expect(run_preflight.decide(ON_MAIN, odd, ISSUE).advice).toContain("git switch '926-a;b'")
	})

	it('names the lane worktree instead of switching onto a branch it has checked out', () => {
		const in_lane: ChildState = { ...OPEN_ON_BRANCH, lane_directory: '/lanes/926 x' }
		const decision = run_preflight.decide(ON_MAIN, in_lane, ISSUE)

		expect(decision.verdict).toBe('resume')
		expect(decision.advice).toContain("cd '/lanes/926 x'")
		expect(decision.advice).not.toContain('git switch')
	})
})

function arrange_issue_branch_with_open_pr(): void {
	vi.mocked(git_stash.has_stashable_changes).mockResolvedValue(false)
	vi.mocked(git_command.branch).mockResolvedValue(ISSUE_BRANCH)
	vi.mocked(git_command.get_default_branch).mockResolvedValue(MAIN)
	vi.mocked(git_command.default_branch_reference).mockResolvedValue('origin/main')
	vi.mocked(git_command.branch_names).mockResolvedValue([ISSUE_BRANCH])
	vi.mocked(git_command.branch_names_remote).mockResolvedValue([])
	vi.mocked(git_gh_pr_read.pr_exists).mockResolvedValue(true)
	vi.mocked(git_gh_pr_read.pr_view).mockResolvedValue('{"state":"OPEN"}')
}

describe('check reads the child on this issue’s own branch', () => {
	it('answers clean over an open pull request instead of reclaiming the branch', async () => {
		arrange_issue_branch_with_open_pr()

		const decision = await run_preflight.check(ISSUE)

		expect(decision.verdict).toBe('clean')
		expect(git_gh_pr_read.pr_exists).toHaveBeenCalledWith(ISSUE_BRANCH)
	})

	it('parks a merged pull request found from its own branch', async () => {
		arrange_issue_branch_with_open_pr()
		vi.mocked(git_gh_pr_read.pr_view).mockResolvedValue('{"state":"MERGED"}')

		const decision = await run_preflight.check(ISSUE)

		expect(decision.verdict).toBe('park')
	})
})
