import { beforeEach, describe, expect, it, vi } from 'vitest'
import { create_spawn_error } from './git-execa-error'

// joshuafolkken/kit#1659: what this pins is the strategy. `git pull` with no `pull.rebase` /
// `pull.ff` aborts on a diverged branch, which is the only branch state worth running this command
// on — so the assertions are about which git commands are asked for, and that none of them is a
// fast-forward-only merge.

vi.mock('./git-command', () => ({
	git_command: {
		branch: vi.fn(),
		diff_numstat_since: vi.fn(),
		fetch_branch: vi.fn(),
		get_default_branch: vi.fn(),
		merge_branch: vi.fn(),
		merge_fast_forward: vi.fn(),
		status: vi.fn(),
		untracked_names: vi.fn(),
	},
}))

vi.mock('./change-base', () => ({
	change_base: { resolved_through_merge: vi.fn().mockResolvedValue('base') },
}))

// The guard's one git read — the paths the default branch would bring in.
vi.mock('./git-spawn', () => ({ git_spawn: { read: vi.fn() } }))

const { git_command } = await import('./git-command')
const { main_merge } = await import('./main-merge')
const { main_merge_guard } = await import('./main-merge-guard')
const { main_merge_regenerate } = await import('./main-merge-regenerate')
const { git_spawn } = await import('./git-spawn')
const { split_early_notice } = await import('#scripts/split/split-early-notice')

// The notice's ledger record; its marker and ledger writes are `split-early-notice.test.ts`'s.
const record_notice = vi.spyOn(split_early_notice, 'record').mockResolvedValue()

const CHANGED_FILE = 'scripts/a.ts'
const MODIFIED_STATUS = ` M ${CHANGED_FILE}`
const CONFLICT_STATUS = `UU ${CHANGED_FILE}`

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const NO_ARGUMENTS: ReadonlyArray<string> = []
const WORKERS_FLAG = '--workers=1'
const ISSUE_BRANCH = '2421-lane'
const PLAIN_BRANCH = 'feature-work'

// The error a real failure arrives as. `git_spawn.with_output` discards execa's own error and
// rethrows `create_spawn_error('merge', code)`, so asserting git's conflict wording instead would
// pin a message this command cannot emit.
const MERGE_EXIT_CODE = 1
const MERGE_FAILURE = create_spawn_error('merge', MERGE_EXIT_CODE)

const fetch_branch = vi.mocked(git_command.fetch_branch)
const merge_branch = vi.mocked(git_command.merge_branch)
const merge_fast_forward = vi.mocked(git_command.merge_fast_forward)

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.mocked(git_command.get_default_branch).mockResolvedValue('main')
	vi.mocked(git_command.branch).mockResolvedValue(PLAIN_BRANCH)
	fetch_branch.mockResolvedValue('')
	merge_branch.mockResolvedValue()
	vi.mocked(git_command.status).mockResolvedValue('')
	vi.mocked(git_spawn.read).mockResolvedValue('')
})

// The split notice's diff read, empty by default so no merge below prints one.
beforeEach(() => {
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
	vi.mocked(git_command.diff_numstat_since).mockResolvedValue('')
	vi.mocked(git_command.untracked_names).mockResolvedValue('')
})

describe('merging the default branch into the current branch', () => {
	it('fetches the default branch and merges it', async () => {
		expect(await main_merge.run(NO_ARGUMENTS)).toBe(SUCCESS_EXIT_CODE)
		expect(fetch_branch).toHaveBeenCalledWith('main')
		expect(merge_branch).toHaveBeenCalledWith('main', undefined)
	})

	// The regression: a fast-forward-only merge fails on a diverged branch exactly as `git pull` did.
	it('never asks for a fast-forward-only merge', async () => {
		await main_merge.run(NO_ARGUMENTS)

		expect(merge_fast_forward).not.toHaveBeenCalled()
	})

	it('follows the repository default branch rather than assuming main', async () => {
		vi.mocked(git_command.get_default_branch).mockResolvedValue('develop')

		await main_merge.run(NO_ARGUMENTS)

		expect(fetch_branch).toHaveBeenCalledWith('develop')
		expect(merge_branch).toHaveBeenCalledWith('develop', undefined)
	})

	it('reports a git failure as a message rather than throwing', async () => {
		merge_branch.mockRejectedValue(MERGE_FAILURE)

		expect(await main_merge.run(NO_ARGUMENTS)).toBe(FAILURE_EXIT_CODE)
		expect(console.error).toHaveBeenCalledWith(MERGE_FAILURE.message)
	})

	it('tells a conflicted merge how to finish through the commit flow', async () => {
		merge_branch.mockRejectedValue(MERGE_FAILURE)
		vi.mocked(git_command.status).mockResolvedValueOnce('').mockResolvedValueOnce(CONFLICT_STATUS)

		await main_merge.run(NO_ARGUMENTS)

		expect(console.error).toHaveBeenCalledWith(main_merge_guard.conflict_hint())
	})
})

// joshuafolkken/kit#3221: `josh ship` branches on what the merge came to, not on an exit code.
describe('the outcome of one merge', () => {
	it('answers current when the default branch brings nothing in', async () => {
		expect(await main_merge.merge()).toStrictEqual({ kind: 'current', branch: 'main' })
	})

	it('answers merged when the default branch brings paths in', async () => {
		vi.mocked(git_spawn.read).mockResolvedValue(CHANGED_FILE)

		expect(await main_merge.merge()).toStrictEqual({ kind: 'merged', branch: 'main' })
	})

	it('answers refused with the guard message and merges nothing', async () => {
		vi.mocked(git_command.status).mockResolvedValue(`UU ${CHANGED_FILE}`)

		expect(await main_merge.merge()).toMatchObject({ kind: 'refused' })
		expect(merge_branch).not.toHaveBeenCalled()
	})

	it('answers conflict with the paths git left unmerged', async () => {
		merge_branch.mockRejectedValue(MERGE_FAILURE)
		vi.mocked(git_command.status).mockResolvedValueOnce('').mockResolvedValueOnce(CONFLICT_STATUS)

		expect(await main_merge.merge()).toStrictEqual({ kind: 'conflict', files: [CHANGED_FILE] })
	})

	// joshuafolkken/kit#3922: a conflict only on generated files is regenerated rather than stopped on.
	it('answers merged once a conflict on generated files alone is regenerated', async () => {
		merge_branch.mockRejectedValue(MERGE_FAILURE)
		vi.mocked(git_command.status).mockResolvedValueOnce('').mockResolvedValueOnce(CONFLICT_STATUS)
		vi.mocked(git_spawn.read).mockResolvedValue(CHANGED_FILE)
		const resolve = vi.spyOn(main_merge_regenerate, 'resolve').mockResolvedValueOnce(true)

		expect(await main_merge.merge()).toStrictEqual({ kind: 'merged', branch: 'main' })
		expect(resolve).toHaveBeenCalledWith([CHANGED_FILE])
	})

	it('rethrows a merge failure that left no unmerged path', async () => {
		merge_branch.mockRejectedValue(MERGE_FAILURE)

		await expect(main_merge.merge()).rejects.toThrow(MERGE_FAILURE.message)
	})
})

// joshuafolkken/kit#2445: merging over uncommitted work the default branch also touched, or over an
// index still holding unresolved paths, is refused before git is asked to merge.
describe('refusing a merge the tree cannot take', () => {
	it('refuses uncommitted changes the default branch also changed, and merges nothing', async () => {
		vi.mocked(git_command.status).mockResolvedValue(MODIFIED_STATUS)
		vi.mocked(git_spawn.read).mockResolvedValue(CHANGED_FILE)

		expect(await main_merge.run(NO_ARGUMENTS)).toBe(FAILURE_EXIT_CODE)
		expect(merge_branch).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('pnpm josh git -y'))
	})

	it('refuses an index with unresolved paths', async () => {
		vi.mocked(git_command.status).mockResolvedValue(`UU ${CHANGED_FILE}`)

		expect(await main_merge.run(NO_ARGUMENTS)).toBe(FAILURE_EXIT_CODE)
		expect(merge_branch).not.toHaveBeenCalled()
	})

	it('still merges over uncommitted changes the merge does not touch', async () => {
		vi.mocked(git_command.status).mockResolvedValue(MODIFIED_STATUS)
		vi.mocked(git_spawn.read).mockResolvedValue('scripts/b.ts')

		expect(await main_merge.run(NO_ARGUMENTS)).toBe(SUCCESS_EXIT_CODE)
		expect(merge_branch).toHaveBeenCalledOnce()
	})
})

// joshuafolkken/kit#2439: git's default merge message carries no `#N`, so the commit-msg hook
// refused the merge on an issue branch and left the index mid-merge.
describe('the merge message on an issue branch', () => {
	it('names the branch issue number so the commit-msg hook accepts the merge', async () => {
		vi.mocked(git_command.branch).mockResolvedValue(ISSUE_BRANCH)

		await main_merge.run(NO_ARGUMENTS)

		expect(merge_branch).toHaveBeenCalledWith('main', 'Merge main into 2421-lane #2421')
	})

	it('keeps git default message on a branch without an issue number', async () => {
		vi.mocked(git_command.branch).mockResolvedValue(PLAIN_BRANCH)

		await main_merge.run(NO_ARGUMENTS)

		expect(merge_branch).toHaveBeenCalledWith('main', undefined)
	})
})

describe('refusing extra arguments', () => {
	it('keeps the message the composite form printed, and runs nothing', async () => {
		expect(await main_merge.run([WORKERS_FLAG])).toBe(FAILURE_EXIT_CODE)
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining('josh main:merge takes no extra arguments'),
		)
	})

	// Ordered before the default-branch read, so the usage error does not depend on git answering.
	it('refuses without asking git anything', async () => {
		await main_merge.run([WORKERS_FLAG])

		expect(fetch_branch).not.toHaveBeenCalled()
		expect(merge_branch).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4302: the merge that precedes the gate tells the run when its diff has outgrown the
// split guide, and stays silent — and successful — otherwise.
const OVER_GUIDE_FILES = 11
const LINES_PER_FILE = 50
const UNDER_GUIDE_NUMSTAT = `${String(LINES_PER_FILE)}\t0\t${CHANGED_FILE}`

function over_guide_numstat(): string {
	return Array.from(
		{ length: OVER_GUIDE_FILES },
		(_unused, index) => `${String(LINES_PER_FILE)}\t0\tscripts/thing-${String(index)}.ts`,
	).join('\n')
}

describe('the split notice before the gate', () => {
	it('warns when the diff clearly exceeds the split guide', async () => {
		vi.mocked(git_command.diff_numstat_since).mockResolvedValue(over_guide_numstat())

		expect(await main_merge.run(NO_ARGUMENTS)).toBe(SUCCESS_EXIT_CODE)
		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('split notice'))
	})

	// joshuafolkken/kit#4695: the notice it prints is the one the lane ledger records.
	it('records the notice it prints', async () => {
		vi.mocked(git_command.diff_numstat_since).mockResolvedValue(over_guide_numstat())

		await main_merge.run(NO_ARGUMENTS)

		expect(record_notice).toHaveBeenCalledWith(expect.objectContaining({ files: OVER_GUIDE_FILES }))
	})

	it('prints nothing for a diff under the guide', async () => {
		vi.mocked(git_command.diff_numstat_since).mockResolvedValue(UNDER_GUIDE_NUMSTAT)

		await main_merge.run(NO_ARGUMENTS)

		expect(console.warn).not.toHaveBeenCalled()
		expect(record_notice).not.toHaveBeenCalled()
	})

	it('keeps a finished merge successful and says the diff was unmeasured when it cannot be read', async () => {
		vi.mocked(git_command.diff_numstat_since).mockRejectedValue(MERGE_FAILURE)

		expect(await main_merge.run(NO_ARGUMENTS)).toBe(SUCCESS_EXIT_CODE)
		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('could not be measured'))
	})
})
