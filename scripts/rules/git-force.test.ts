import { describe, expect, it } from 'vitest'
import { git_force } from './git-force'

// A force push or a branch delete spelled so the deny glob misses it. The refused set pins those
// spellings on the predicate (the reason text does not enumerate them); the silent set is the
// ordinary push and branch work the deny list also leaves alone.

describe('git_force.is_force_or_delete — refuses the spellings the deny glob misses', () => {
	it.each([
		'git push -uf origin main',
		'git -C /repo push --force',
		'git push origin :branch',
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
		'pnpm josh git',
		'operating-rules.md',
		'fires on every occurrence',
	])('carries %j', (marker) => {
		expect(git_force.GIT_FORCE_REASON).toContain(marker)
	})
})
