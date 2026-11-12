import { git_argv } from '#scripts/rules/git-argv'
import { describe, expect, it } from 'vitest'
import { implementation_shell_deny_git } from './implementation-shell-deny-git'

const GIT_PUSH = '`git push`'

const REFUSED: ReadonlyArray<readonly [string, string]> = [
	['git push origin main', `${GIT_PUSH}, a git write`],
	["git 'push'", GIT_PUSH],
	['"git" push', GIT_PUSH],
	['git branch -D topic', '`git branch`'],
	['git stash pop', '`git stash`'],
	['git reflog expire --all', '`git reflog`'],
	['git -c core.fsmonitor=x status', 'rewrites its configuration'],
	['git $c origin', '`git $c`, an expansion that may spell a write'],
]

const ALLOWED: ReadonlyArray<string> = [
	'git status',
	'git log --oneline',
	'git branch --list topic*',
	'git branch --sort refname',
	'git stash list',
	'git config --get user.name',
	'git tag',
	'git reflog',
]

function refusal(segment: string): string | undefined {
	const call = git_argv.program_of(segment)
	if (call === undefined) return undefined

	return implementation_shell_deny_git.refusal(segment, call.args)
}

describe('implementation_shell_deny_git.refusal', () => {
	it.each(REFUSED)('refuses %s, naming %s', (segment, rule) => {
		expect(refusal(segment)).toContain(rule)
	})

	it.each(ALLOWED)('lets %s run', (segment) => {
		expect(refusal(segment)).toBeUndefined()
	})
})
