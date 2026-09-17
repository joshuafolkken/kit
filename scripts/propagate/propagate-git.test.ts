import { afterEach, describe, expect, it } from 'vitest'
import { propagate_git } from './propagate-git'

const MAIN = 'main'
const NOT_A_REPOSITORY = '/nonexistent-propagate-probe'
const NOT_READABLE = 'not a readable git repository'

describe('propagate_git.decide_tree_state', () => {
	it('is ready on a clean, current default branch', () => {
		expect(propagate_git.decide_tree_state(MAIN, MAIN, true, true).is_ready).toBe(true)
	})

	// `josh git` stages the whole tree, so a consumer's unrelated work in progress would ride into
	// the upgrade commit and the pull request.
	it('refuses a working tree with uncommitted changes', () => {
		const state = propagate_git.decide_tree_state(MAIN, MAIN, false, true)

		expect(state.is_ready).toBe(false)
		expect(state.reason).toContain('uncommitted')
	})

	it('refuses a repository parked on a feature branch', () => {
		const state = propagate_git.decide_tree_state('123-something', MAIN, true, true)

		expect(state.is_ready).toBe(false)
		expect(state.reason).toContain('not main')
	})

	// Run from a checkout that is behind, the version read is the previous release — already
	// published, so the wait passes and every consumer is sent to a version without the change.
	it('refuses a branch that is behind its remote', () => {
		const state = propagate_git.decide_tree_state(MAIN, MAIN, true, false)

		expect(state.is_ready).toBe(false)
		expect(state.reason).toContain('not up to date')
	})

	it('checks the tree before the branch, so the louder problem is the one reported', () => {
		expect(propagate_git.decide_tree_state('feature', MAIN, false, true).reason).toContain(
			'uncommitted',
		)
	})

	it('accepts a repository whose default branch is not called main', () => {
		expect(propagate_git.decide_tree_state('trunk', 'trunk', true, true).is_ready).toBe(true)
	})
})

// joshuafolkken/kit#1515: git exports `GIT_DIR` to every hook it runs, and it beats `cwd` — so under
// `pnpm josh git`'s pre-push hook every probe here answered about the checkout the hook was firing in
// rather than the path it was handed. A directory that is not a repository read as one, and the tree
// check went out to `origin` for it. Asserted through the real `execaSync`, because the defect is in
// which environment the child gets and a mocked spawn would not have it.
describe('propagate_git — the environment the probes run in', () => {
	const outer_git_directory = process.env['GIT_DIR']

	afterEach(() => {
		if (outer_git_directory === undefined) delete process.env['GIT_DIR']
		else process.env['GIT_DIR'] = outer_git_directory
	})

	it('answers about the path it was handed even with GIT_DIR set', () => {
		process.env['GIT_DIR'] = process.cwd()

		const state = propagate_git.tree_state(NOT_A_REPOSITORY)

		expect(state.is_ready).toBe(false)
		expect(state.reason).toContain(NOT_READABLE)
	})
})

describe('propagate_git.tree_state', () => {
	it('refuses a directory that is not a git repository', () => {
		const state = propagate_git.tree_state(NOT_A_REPOSITORY)

		expect(state.is_ready).toBe(false)
		expect(state.reason).toContain(NOT_READABLE)
	})
})
