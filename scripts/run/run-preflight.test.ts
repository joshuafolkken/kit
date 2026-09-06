import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	run_preflight,
	type ChildState,
	type PreflightVerdict,
	type PrState,
	type TreeState,
} from './run-preflight'

// `git_command` is mocked rather than `run_hold`: `run_hold.is_tree_dirty` reads through
// `git_command.status`, so mocking the one module exercises the reuse instead of replacing it.
vi.mock('#scripts/git/git-command', () => ({
	git_command: {
		branch: vi.fn(),
		branch_names: vi.fn(),
		branch_names_remote: vi.fn(),
		get_default_branch: vi.fn(),
		status: vi.fn(),
	},
}))

vi.mock('#scripts/git/git-gh-pr-read', () => ({
	git_gh_pr_read: { pr_exists: vi.fn(), pr_view: vi.fn() },
}))

const { git_command } = await import('#scripts/git/git-command')
const { git_gh_pr_read } = await import('#scripts/git/git-gh-pr-read')

const branch = vi.mocked(git_command.branch)
const branch_names = vi.mocked(git_command.branch_names)
const branch_names_remote = vi.mocked(git_command.branch_names_remote)
const default_branch = vi.mocked(git_command.get_default_branch)
const status = vi.mocked(git_command.status)
const pr_exists = vi.mocked(git_gh_pr_read.pr_exists)
const pr_view = vi.mocked(git_gh_pr_read.pr_view)

const ISSUE = '926'
const CLEAN_TREE: TreeState = { branch: 'main', default_branch: 'main', is_dirty: false }
const NO_WORK: ChildState = { branch_name: undefined, pr_state: 'none' }

function child(pr_state: PrState, branch_name?: string): ChildState {
	return { branch_name, pr_state }
}

function verdict_of(tree: TreeState, state: ChildState): PreflightVerdict {
	return run_preflight.decide(tree, state, ISSUE).verdict
}

function arrange_clean_tree(): void {
	status.mockResolvedValue('')
	branch.mockResolvedValue('main')
	default_branch.mockResolvedValue('main')
	branch_names.mockResolvedValue([])
	branch_names_remote.mockResolvedValue([])
}

afterEach(() => {
	vi.resetAllMocks()
})

describe('the four states an interrupted run leaves behind', () => {
	it.each([
		['a dirty tree', { ...CLEAN_TREE, is_dirty: true }, NO_WORK, 'reclaim'],
		['HEAD off the default branch', { ...CLEAN_TREE, branch: '926-x' }, NO_WORK, 'reclaim'],
		['a branch left for this issue', CLEAN_TREE, child('none', '926-x'), 'resume'],
		['an open pull request', CLEAN_TREE, child('open'), 'resume'],
		['a merged pull request', CLEAN_TREE, child('merged', '926-x'), 'park'],
		['a closed pull request', CLEAN_TREE, child('closed', '926-x'), 'park'],
		['nothing at all', CLEAN_TREE, NO_WORK, 'clean'],
	])('%s answers %j', (_name, tree, state, expected) => {
		expect(verdict_of(tree, state)).toBe(expected)
	})
})

describe('the precedence between them is fixed', () => {
	it('reclaims a dirty tree before it reads anything about the child', () => {
		expect(verdict_of({ ...CLEAN_TREE, is_dirty: true }, child('merged', '926-x'))).toBe('reclaim')
	})

	it('parks a decided pull request rather than resuming its branch', () => {
		expect(verdict_of(CLEAN_TREE, child('merged', '926-x'))).toBe('park')
	})
})

describe('the advice names what the rule requires', () => {
	it('stashes with -u and records the stash instead of popping it', () => {
		const { advice } = run_preflight.decide({ ...CLEAN_TREE, is_dirty: true }, NO_WORK, ISSUE)

		expect(advice).toContain(`git stash push -u -m "${run_preflight.STASH_LABEL_PREFIX}${ISSUE}"`)
		expect(advice).toContain(`Record the stash on #${ISSUE}`)
		expect(advice).not.toContain('git stash pop')
	})

	// A clean checkout parked on a feature branch also answers `reclaim`, and telling the caller to
	// record a stash `git stash push` never created posts an Issue comment naming nothing.
	it('prescribes no stash over a clean tree that is merely on the wrong branch', () => {
		const tree: TreeState = { branch: '926-x', default_branch: 'main', is_dirty: false }
		const { advice } = run_preflight.decide(tree, NO_WORK, ISSUE)

		expect(advice).not.toContain('git stash')
		expect(advice).not.toContain('Record the stash')
		expect(advice).toContain('git switch main && git pull')
	})

	it('switches to the branch git reported, not to a hard-coded main', () => {
		const tree: TreeState = { branch: 'work', default_branch: 'trunk', is_dirty: false }

		expect(run_preflight.decide(tree, NO_WORK, ISSUE).advice).toContain(
			'git switch trunk && git pull',
		)
	})

	it('requires the whole verification gate when a branch is reused', () => {
		expect(run_preflight.decide(CLEAN_TREE, child('open', '926-x'), ISSUE).advice).toBe(
			run_preflight.RESUME_ADVICE,
		)
		expect(run_preflight.RESUME_ADVICE).toContain('from the start')
	})

	it('names what was found in the reason', () => {
		expect(run_preflight.decide(CLEAN_TREE, child('open', '926-x'), ISSUE).reason).toContain(
			'926-x',
		)
	})
})

const BRANCH = '926-reclaim-a-tree'
const OPEN_PR_JSON = '{"state":"OPEN"}'
const MERGED_PR_JSON = '{"state":"MERGED"}'

describe('a pull request state is read from what gh answered', () => {
	it.each([
		[OPEN_PR_JSON, 'open'],
		[MERGED_PR_JSON, 'merged'],
		['{"state":"CLOSED"}', 'closed'],
		['', 'none'],
		['not json', 'none'],
		['{"state":"DRAFT"}', 'none'],
	])('%j reads as %j', (raw, expected) => {
		expect(run_preflight.to_pr_state(raw)).toBe(expected)
	})
})

async function verdict_from_check(): Promise<PreflightVerdict> {
	const decision = await run_preflight.check(ISSUE)

	return decision.verdict
}

function arrange_dirty_tree(): void {
	status.mockResolvedValue(' M scripts/run/run-preflight.ts')
	branch.mockResolvedValue('main')
	default_branch.mockResolvedValue('main')
}

describe('check finds the branch an interrupted run left', () => {
	it('matches it by the issue glob and reports resume', async () => {
		arrange_clean_tree()
		branch_names.mockResolvedValue([BRANCH])
		pr_exists.mockResolvedValue(true)
		pr_view.mockResolvedValue(OPEN_PR_JSON)

		expect(await verdict_from_check()).toBe('resume')
		expect(branch_names).toHaveBeenCalledWith('926-*')
	})

	// A run interrupted on another machine leaves the branch on the remote with no local counterpart;
	// searching locally alone would answer `clean` over an open pull request.
	it('finds a remote-tracking branch and strips the remote off its name', async () => {
		arrange_clean_tree()
		branch_names_remote.mockResolvedValue([`origin/${BRANCH}`])
		pr_exists.mockResolvedValue(true)
		pr_view.mockResolvedValue(OPEN_PR_JSON)

		expect(await verdict_from_check()).toBe('resume')
		expect(branch_names_remote).toHaveBeenCalledWith('*/926-*')
		expect(pr_exists).toHaveBeenCalledExactlyOnceWith(BRANCH)
	})

	// A retry branch beside the original must not hide the merged pull request behind it.
	it('lets a decided pull request on any candidate outrank an open one', async () => {
		arrange_clean_tree()
		branch_names.mockResolvedValue(['926-first', '926-retry'])
		pr_exists.mockResolvedValue(true)
		pr_view.mockImplementation(async (name) =>
			name === '926-first' ? OPEN_PR_JSON : MERGED_PR_JSON,
		)

		expect(await verdict_from_check()).toBe('park')
	})

	it('answers clean when nothing was left', async () => {
		arrange_clean_tree()

		expect(await verdict_from_check()).toBe('clean')
		expect(pr_exists).not.toHaveBeenCalled()
		expect(pr_view).not.toHaveBeenCalled()
	})
})

describe('check refuses to read an absence into a failed read', () => {
	// `pr_view` folds "no pull request" and "the read failed" into the same empty answer, so the
	// existence question goes through `pr_exists`, which throws instead — and that reaches `unknown`.
	it('propagates an unreadable gh lookup rather than reading it as no pull request', async () => {
		arrange_clean_tree()
		branch_names.mockResolvedValue(['926-x'])
		pr_exists.mockRejectedValue(new Error('gh is rate limited'))

		await expect(run_preflight.check(ISSUE)).rejects.toThrow('rate limited')
	})

	it('treats an unreadable status as a dirty tree, the way run_hold does', async () => {
		status.mockRejectedValue(new Error('no git here'))
		branch.mockResolvedValue('main')
		default_branch.mockResolvedValue('main')

		expect(await verdict_from_check()).toBe('reclaim')
	})

	it('spends no gh round trip once the tree already answers reclaim', async () => {
		arrange_dirty_tree()

		expect(await verdict_from_check()).toBe('reclaim')
		expect(branch_names).not.toHaveBeenCalled()
		expect(pr_view).not.toHaveBeenCalled()
	})
})
