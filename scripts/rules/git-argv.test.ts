import { describe, expect, it } from 'vitest'
import { git_argv } from './git-argv'

// joshuafolkken/kit#2120: the shared reading of a shell segment as a git invocation. What matters is
// that it skips the wrapper and git's globals to reach the subcommand — and that `pnpm josh git` is not
// mistaken for one, since that is the authorized node route the deny list already leaves alone.

describe('git_argv.parse', () => {
	it('reads the subcommand of a bare git command', () => {
		expect(git_argv.parse('git push origin main')?.subcommand).toBe('push')
	})

	it('skips a -C <path> prefix and keeps the arguments after the subcommand', () => {
		const call = git_argv.parse('git -C /tmp/x push --force')

		expect(call?.subcommand).toBe('push')
		expect(call?.args).toStrictEqual(['--force'])
	})

	it('skips a -c key=value global', () => {
		expect(git_argv.parse('git -c user.name=x branch -D old')?.subcommand).toBe('branch')
	})

	it('skips a sudo wrapper', () => {
		expect(git_argv.parse('sudo git stash')?.subcommand).toBe('stash')
	})

	it('is not a git command when josh stands between the wrapper and git', () => {
		expect(git_argv.parse('pnpm josh git -y "title #1"')).toBeUndefined()
	})

	it('is undefined for a non-git command', () => {
		expect(git_argv.parse('gh api repos/o/r/issues')).toBeUndefined()
	})
})

describe('git_argv.short_cluster_has', () => {
	it('finds a letter bundled in a single-dash cluster', () => {
		expect(git_argv.short_cluster_has('-uf', 'f')).toBe(true)
	})

	it('does not read a long flag as a cluster', () => {
		expect(git_argv.short_cluster_has('--force', 'f')).toBe(false)
	})
})
