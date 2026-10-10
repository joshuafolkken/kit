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
		commit_count_beyond: vi.fn(),
		default_branch_reference: vi.fn(),
		get_default_branch: vi.fn(),
		status: vi.fn(),
	},
}))

vi.mock('#scripts/gh/git-gh-pr-read', () => ({
	git_gh_pr_read: { pr_exists: vi.fn(), pr_view: vi.fn() },
}))

vi.mock('#scripts/lane/lane-registry', () => ({
	lane_registry: { find_open_lane: vi.fn() },
}))

const { git_command } = await import('#scripts/git/git-command')
const { git_gh_pr_read } = await import('#scripts/gh/git-gh-pr-read')
const { lane_registry } = await import('#scripts/lane/lane-registry')

const branch = vi.mocked(git_command.branch)
const branch_names = vi.mocked(git_command.branch_names)
const branch_names_remote = vi.mocked(git_command.branch_names_remote)
const commit_count_beyond = vi.mocked(git_command.commit_count_beyond)
const default_branch_reference = vi.mocked(git_command.default_branch_reference)
const default_branch = vi.mocked(git_command.get_default_branch)
const status = vi.mocked(git_command.status)
const pr_exists = vi.mocked(git_gh_pr_read.pr_exists)
const pr_view = vi.mocked(git_gh_pr_read.pr_view)
const find_open_lane = vi.mocked(lane_registry.find_open_lane)

const ISSUE = '926'
const CLEAN_TREE: TreeState = { branch: 'main', default_branch: 'main', is_dirty: false }
const NO_WORK: ChildState = { branch_name: undefined, pr_state: 'none' }
const BASE_REFERENCE = 'origin/main'

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
	default_branch_reference.mockResolvedValue(BASE_REFERENCE)
	branch_names.mockResolvedValue([])
	branch_names_remote.mockResolvedValue([])
	commit_count_beyond.mockResolvedValue(1)
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

	// A retry branch beside the original must not hide the merged pull request behind it, and the
	// reason must name the branch the winning state came from rather than whichever git listed first.
	it('lets a decided pull request on any candidate outrank an open one', async () => {
		arrange_clean_tree()
		branch_names.mockResolvedValue(['926-first', '926-retry'])
		pr_exists.mockResolvedValue(true)
		pr_view.mockImplementation(async (name) =>
			name === '926-first' ? OPEN_PR_JSON : MERGED_PR_JSON,
		)

		expect(await verdict_from_check()).toBe('park')
	})
})

describe('check names the branch the verdict came from', () => {
	it('reports the candidate that carried the winning state, not the first git listed', async () => {
		arrange_clean_tree()
		branch_names.mockResolvedValue(['926-first', '926-retry'])
		pr_exists.mockImplementation(async (name) => name === '926-retry')
		pr_view.mockResolvedValue(OPEN_PR_JSON)

		const decision = await run_preflight.check(ISSUE)

		expect(decision.verdict).toBe('resume')
		expect(decision.reason).toContain('926-retry')
	})

	it('answers clean when nothing was left', async () => {
		arrange_clean_tree()

		expect(await verdict_from_check()).toBe('clean')
		expect(pr_exists).not.toHaveBeenCalled()
		expect(pr_view).not.toHaveBeenCalled()
	})
})

// A lane that ended before implementing leaves a branch at the default branch's commit and no pull
// request; its mere existence is not a partial implementation (joshuafolkken/kit#2855).
describe('check counts a branch as leftover work only when it holds commits or a pull request', () => {
	it('answers clean for a branch with no pull request and no commit beyond the default branch', async () => {
		arrange_clean_tree()
		branch_names.mockResolvedValue([BRANCH])
		pr_exists.mockResolvedValue(false)
		commit_count_beyond.mockResolvedValue(0)

		expect(await verdict_from_check()).toBe('clean')
		expect(commit_count_beyond).toHaveBeenCalledExactlyOnceWith(BASE_REFERENCE, BRANCH)
	})

	it('counts a remote-only branch through the remote-tracking ref it was found as', async () => {
		arrange_clean_tree()
		branch_names_remote.mockResolvedValue([`origin/${BRANCH}`])
		pr_exists.mockResolvedValue(false)
		commit_count_beyond.mockResolvedValue(0)

		expect(await verdict_from_check()).toBe('clean')
		expect(commit_count_beyond).toHaveBeenCalledExactlyOnceWith(BASE_REFERENCE, `origin/${BRANCH}`)
	})

	it('resumes when only the remote copy of a local branch holds commits', async () => {
		arrange_clean_tree()
		branch_names.mockResolvedValue([BRANCH])
		branch_names_remote.mockResolvedValue([`origin/${BRANCH}`])
		pr_exists.mockResolvedValue(false)
		commit_count_beyond.mockImplementation(async (_base, tip) => (tip === BRANCH ? 0 : 1))

		expect(await verdict_from_check()).toBe('resume')
		expect(commit_count_beyond).toHaveBeenCalledWith(BASE_REFERENCE, `origin/${BRANCH}`)
	})
})

describe('check still resumes a branch that holds commits or a pull request', () => {
	it('still resumes a branch with commits beyond the default branch and no pull request', async () => {
		arrange_clean_tree()
		branch_names.mockResolvedValue([BRANCH])
		pr_exists.mockResolvedValue(false)

		const decision = await run_preflight.check(ISSUE)

		expect(decision.verdict).toBe('resume')
		expect(decision.reason).toContain(BRANCH)
	})

	it('still resumes an open pull request without counting its commits', async () => {
		arrange_clean_tree()
		branch_names.mockResolvedValue([BRANCH])
		pr_exists.mockResolvedValue(true)
		pr_view.mockResolvedValue(OPEN_PR_JSON)
		commit_count_beyond.mockResolvedValue(0)

		expect(await verdict_from_check()).toBe('resume')
		expect(commit_count_beyond).not.toHaveBeenCalled()
	})
})

const LANE_DIRECTORY = '/repo/.repo-lanes/926'
const LANE_CHANGE = ' M src/feature.ts'

function arrange_lane_on(lane_branch: string, lane_status: string, is_stranded = false): void {
	arrange_clean_tree()
	branch_names.mockResolvedValue([BRANCH])
	pr_exists.mockResolvedValue(false)
	commit_count_beyond.mockResolvedValue(0)
	find_open_lane.mockResolvedValue({
		issue: ISSUE,
		branch: lane_branch,
		directory: LANE_DIRECTORY,
		seat: undefined,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		profile: undefined,
		is_stranded,
	})
	status.mockImplementation(async (directory) => (directory === LANE_DIRECTORY ? lane_status : ''))
}

// A lane stopped mid-implementation holds its work uncommitted on a branch with no commit yet, so
// commits alone would read it as nothing left behind.
describe('check counts the uncommitted work a lane holds on a branch with no commits', () => {
	it('resumes when the lane checked out on the branch has uncommitted changes', async () => {
		arrange_lane_on(BRANCH, LANE_CHANGE)

		expect(await verdict_from_check()).toBe('resume')
		expect(find_open_lane).toHaveBeenCalledWith(ISSUE)
		expect(status).toHaveBeenCalledWith(LANE_DIRECTORY)
	})

	it('answers clean when that lane is clean', async () => {
		arrange_lane_on(BRANCH, '')

		expect(await verdict_from_check()).toBe('clean')
	})

	it('ignores a dirty lane checked out on another branch', async () => {
		arrange_lane_on('926-lane', LANE_CHANGE)

		expect(await verdict_from_check()).toBe('clean')
		expect(status).not.toHaveBeenCalledWith(LANE_DIRECTORY)
	})

	// A stranded lane's directory is gone, and an unreadable status would otherwise read as dirty.
	it('ignores a stranded lane whose work tree is gone', async () => {
		arrange_lane_on(BRANCH, LANE_CHANGE, true)

		expect(await verdict_from_check()).toBe('clean')
		expect(status).not.toHaveBeenCalledWith(LANE_DIRECTORY)
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

	// `pr_exists` and `pr_view` are two round trips; a failure arriving between them would otherwise
	// put a merged pull request back through the empty answer and out as `resume`.
	it('refuses an empty pr_view for a branch pr_exists just confirmed', async () => {
		arrange_clean_tree()
		branch_names.mockResolvedValue(['926-x'])
		pr_exists.mockResolvedValue(true)
		pr_view.mockResolvedValue('')

		await expect(run_preflight.check(ISSUE)).rejects.toThrow('926-x')
	})

	it('refuses an issue number it would otherwise interpolate into a shell command', async () => {
		await expect(run_preflight.check('9"; rm -rf /')).rejects.toThrow('Not an issue number')
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
