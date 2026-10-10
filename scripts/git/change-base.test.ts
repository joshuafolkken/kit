import { afterEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#1537: this resolver is the whole reason the base guard cannot fail open, so the
// throwing arm is the case worth pinning. `change_base` degrades to the default-branch **name** when
// `merge-base` cannot answer, and a name moves — two records storing that same string compare equal
// while the tree under them is replaced. Answering `undefined` is what makes every caller widen its
// round instead of trusting a comparison it cannot make.

vi.mock('./git-command', () => ({
	git_command: { change_base_commit: vi.fn(), default_branch_reference: vi.fn() },
}))
vi.mock('./git-spawn', () => ({ git_spawn: { read: vi.fn() } }))

const { git_command } = await import('./git-command')
const { git_spawn } = await import('./git-spawn')
const { change_base } = await import('./change-base')

const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const INCOMING = '89abcdef0123456789abcdef0123456789abcdef'
const DEFAULT_REFERENCE = 'refs/remotes/origin/main'
const MERGE_BASE = 'merge-base'
const NO_REVISION = 'fatal: Needed a single revision'
const NO_MERGE = 'fatal: Not a valid object name MERGE_HEAD'
const change_base_commit = vi.mocked(git_command.change_base_commit)
const read = vi.mocked(git_spawn.read)

afterEach(() => {
	vi.resetAllMocks()
})

describe('change_base.resolved', () => {
	it('answers the commit the change is measured against', async () => {
		change_base_commit.mockResolvedValue(COMMIT)

		expect(await change_base.resolved()).toBe(COMMIT)
	})

	// Never the ref name `change_base` falls back to, and never a throw the caller has to guard: a
	// caller that cannot resolve the base has to know it cannot, so its comparison fails closed.
	it('answers undefined rather than throwing when the base cannot be resolved', async () => {
		change_base_commit.mockRejectedValue(new Error(NO_REVISION))

		expect(await change_base.resolved()).toBeUndefined()
	})
})

// joshuafolkken/kit#3644: a merge of the default branch that stopped on a conflict leaves `HEAD` on
// the commit before it while the work tree already holds the default branch's files, so totals
// measured against the base of `HEAD` read everything that merge brought in as this branch's growth.
describe('change_base.resolved_through_merge', () => {
	it('answers the later of the two bases while a merge is in progress', async () => {
		change_base_commit.mockResolvedValue(COMMIT)
		vi.mocked(git_command.default_branch_reference).mockResolvedValue(DEFAULT_REFERENCE)
		read.mockResolvedValue(INCOMING)

		expect(await change_base.resolved_through_merge()).toBe(INCOMING)
		expect(read).toHaveBeenCalledWith([MERGE_BASE, DEFAULT_REFERENCE, 'MERGE_HEAD'])
		expect(read).toHaveBeenCalledWith([MERGE_BASE, '--independent', COMMIT, INCOMING])
	})

	it('answers the base of HEAD where no merge is in progress', async () => {
		change_base_commit.mockResolvedValue(COMMIT)
		read.mockRejectedValue(new Error(NO_MERGE))

		expect(await change_base.resolved_through_merge()).toBe(COMMIT)
	})

	it('answers undefined where the base of HEAD cannot be resolved', async () => {
		change_base_commit.mockRejectedValue(new Error(NO_REVISION))
		read.mockResolvedValue(INCOMING)

		expect(await change_base.resolved_through_merge()).toBeUndefined()
	})
})
