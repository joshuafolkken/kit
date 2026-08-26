import { describe, expect, it } from 'vitest'
import { propagate_git } from './propagate-git'

const MAIN = 'main'

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

describe('propagate_git.tree_state', () => {
	it('refuses a directory that is not a git repository', () => {
		const state = propagate_git.tree_state('/nonexistent-propagate-probe')

		expect(state.is_ready).toBe(false)
		expect(state.reason).toContain('not a readable git repository')
	})
})
