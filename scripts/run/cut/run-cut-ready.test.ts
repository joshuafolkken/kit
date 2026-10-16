import { describe, expect, it } from 'vitest'
import { run_cut_ready, type CutTree } from './run-cut-ready'

// joshuafolkken/kit#3881: the implementation-cut guard refused edits on a run held on the default
// branch, where `run:cut --impl` could only answer `unready`. Both now read this one predicate.

const DEFAULT_BRANCH = 'main'

function tree(branch: string, is_dirty: boolean): CutTree {
	return { branch, default_branch: DEFAULT_BRANCH, is_dirty }
}

describe('run_cut_ready.is_ready', () => {
	it('is ready on an uncommitted branch other than the default one', () => {
		expect(run_cut_ready.is_ready(tree('3881-lane', true))).toBe(true)
	})

	it.each([
		['the default branch, dirty', tree(DEFAULT_BRANCH, true)],
		['a lane branch with nothing uncommitted', tree('3881-lane', false)],
	])('is not ready on %s', (_label, value) => {
		expect(run_cut_ready.is_ready(value)).toBe(false)
	})
})

describe('run_cut_ready.tree_of', () => {
	it('reads the branch header and an uncommitted change', () => {
		const status = '# branch.oid abc\n# branch.head 3881-lane\n? scripts/x.ts\n'

		expect(run_cut_ready.tree_of(status, DEFAULT_BRANCH)).toStrictEqual(tree('3881-lane', true))
	})

	it('reads a tree with only header lines as clean', () => {
		const status = '# branch.oid abc\n# branch.head main\n'

		expect(run_cut_ready.tree_of(status, DEFAULT_BRANCH)).toStrictEqual(tree(DEFAULT_BRANCH, false))
	})

	it('answers nothing for output with no branch header', () => {
		expect(run_cut_ready.tree_of('', DEFAULT_BRANCH)).toBeUndefined()
	})
})

describe('run_cut_ready.is_ready_sync', () => {
	it('answers the predicate over the tree it reads', () => {
		expect(run_cut_ready.is_ready_sync(() => tree(DEFAULT_BRANCH, true))).toBe(false)
		expect(run_cut_ready.is_ready_sync(() => tree('3881-lane', true))).toBe(true)
	})

	// A read fault keeps the guard speaking rather than silencing it on the run it exists for.
	it('reads a tree git cannot describe as ready', () => {
		expect(run_cut_ready.is_ready_sync(() => undefined)).toBe(true)
	})
})
