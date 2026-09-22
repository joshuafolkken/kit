import { describe, expect, it } from 'vitest'
import { josh_git_bare } from './josh-git-bare'

// joshuafolkken/kit#2297: a `pnpm josh git` with no `-y` / `--yes` is refused — it prompts to confirm
// the staging, cancels with no TTY, and the run reissues with `-y` after throwing the time away. The
// `-y` form and the alias `g` are read the same way, and a name quoted inside a body is not the call.

describe('josh_git_bare.is_bare_josh_git', () => {
	it.each([
		['bare', 'pnpm josh git'],
		['bare with title', 'pnpm josh git "fix the thing #5"'],
		['alias', 'pnpm josh g'],
		['after a cd', 'cd /repo && pnpm josh git'],
	])('refuses the %s form', (_name, command) => {
		expect(josh_git_bare.is_bare_josh_git(command)).toBe(true)
	})

	it.each([
		['-y', 'pnpm josh git -y "fix the thing #5"'],
		['--yes', 'pnpm josh git --yes "fix the thing #5"'],
		['-y alias', 'pnpm josh g -y "fix the thing #5"'],
		['recovery form', 'pnpm josh git -y --skip-commit --skip-push'],
	])('is silent on the %s form', (_name, command) => {
		expect(josh_git_bare.is_bare_josh_git(command)).toBe(false)
	})

	it('is silent on a different josh command', () => {
		expect(josh_git_bare.is_bare_josh_git('pnpm josh gate')).toBe(false)
	})

	it('is silent when the name is only quoted inside a body', () => {
		expect(
			josh_git_bare.is_bare_josh_git('gh issue comment 5 -b "run pnpm josh git after this"'),
		).toBe(false)
	})
})
