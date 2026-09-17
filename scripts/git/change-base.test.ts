import { describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#1537: this resolver is the whole reason the base guard cannot fail open, so the
// throwing arm is the case worth pinning. `change_base` degrades to the default-branch **name** when
// `merge-base` cannot answer, and a name moves — two records storing that same string compare equal
// while the tree under them is replaced. Answering `undefined` is what makes every caller widen its
// round instead of trusting a comparison it cannot make.

vi.mock('./git-command', () => ({ git_command: { change_base_commit: vi.fn() } }))

const { git_command } = await import('./git-command')
const { change_base } = await import('./change-base')

const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const change_base_commit = vi.mocked(git_command.change_base_commit)

describe('change_base.resolved', () => {
	it('answers the commit the change is measured against', async () => {
		change_base_commit.mockResolvedValue(COMMIT)

		expect(await change_base.resolved()).toBe(COMMIT)
	})

	// Never the ref name `change_base` falls back to, and never a throw the caller has to guard: a
	// caller that cannot resolve the base has to know it cannot, so its comparison fails closed.
	it('answers undefined rather than throwing when the base cannot be resolved', async () => {
		change_base_commit.mockRejectedValue(new Error('fatal: Needed a single revision'))

		expect(await change_base.resolved()).toBeUndefined()
	})
})
