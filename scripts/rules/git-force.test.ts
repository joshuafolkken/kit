import { describe, expect, it } from 'vitest'
import { git_force } from './git-force'

// The colon-form delete, named once because it is both a refused spelling and a marker the reason
// carries — the one literal that would otherwise repeat.
const COLON_DELETE = 'git push origin :branch'

// joshuafolkken/kit#2120, group 1: a force push or a branch delete spelled so the deny glob misses it.
// The refused set is exactly the acceptance criteria's; the silent set is the ordinary push and branch
// work the deny list also leaves alone.

describe('git_force.is_force_or_delete — refuses the spellings the deny glob misses', () => {
	it.each([
		'git push -uf origin main',
		'git -C /repo push --force',
		COLON_DELETE,
		'git push origin +main:main',
		'git push origin +refs/heads/x:refs/heads/x',
		'git branch -D old',
		'git push --force-with-lease',
		'git push --delete origin topic',
		'git branch --delete feature',
	])('refuses %j', (command) => {
		expect(git_force.is_force_or_delete(command)).toBe(true)
	})

	it.each([
		'git push',
		'git push origin main',
		'git push -u origin main',
		'git push origin src:dst',
		'git branch',
		'git branch feature',
		'git branch -m renamed',
		'pnpm josh git -y "title #1"',
		'echo "git push --force"',
	])('is silent on %j', (command) => {
		expect(git_force.is_force_or_delete(command)).toBe(false)
	})
})

describe('git_force.GIT_FORCE_REASON', () => {
	it.each([
		'force push or branch delete',
		'Tier C',
		'git push -uf',
		COLON_DELETE,
		'operating-rules.md',
		'fires on every occurrence',
	])('carries %j', (marker) => {
		expect(git_force.GIT_FORCE_REASON).toContain(marker)
	})
})
