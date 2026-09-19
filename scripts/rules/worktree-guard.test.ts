import { describe, expect, it } from 'vitest'
import { worktree_guard } from './worktree-guard'

// joshuafolkken/kit#2120, group 2: an unauthorized working-tree change. The silent set is the point the
// Issue's premise got wrong — an authorized stash push is a raw `git stash push -m`, not a node call —
// so the message form and the read-only forms pass, alongside `pnpm josh git` and `pnpm josh stash:pop`.

describe('worktree_guard.is_unauthorized_worktree_change — refuses', () => {
	it.each([
		'git checkout -- src/app.ts',
		'git restore src/app.ts',
		'git restore --worktree src/app.ts',
		'git stash',
		'git stash push',
		'git stash pop',
		'git stash apply',
		'git stash drop',
		'git -C /repo stash',
	])('refuses %j', (command) => {
		expect(worktree_guard.is_unauthorized_worktree_change(command)).toBe(true)
	})

	it.each([
		'git stash push -u -m "fullrun: paused #1 for prerequisite #2"',
		'git stash push -m "fullrun new: pre-existing changes"',
		'git stash list',
		'git stash show',
		'git restore --staged src/app.ts',
		'git checkout main',
		'git checkout -b feature',
		'pnpm josh git -y "title #1"',
		'pnpm josh stash:pop "fullrun: paused #1 for prerequisite #2"',
	])('is silent on %j', (command) => {
		expect(worktree_guard.is_unauthorized_worktree_change(command)).toBe(false)
	})
})

describe('worktree_guard.WORKTREE_MUTATION_REASON', () => {
	it.each([
		'unauthorized working-tree change',
		'pnpm josh stash:pop',
		'git stash push -u -m',
		'operating-rules.md',
		'fires on every occurrence',
	])('carries %j', (marker) => {
		expect(worktree_guard.WORKTREE_MUTATION_REASON).toContain(marker)
	})
})
