import { git_argv } from '#scripts/rules/git-argv'
import { describe, expect, it } from 'vitest'
import { implementation_shell_nested } from './implementation-shell-nested'

function call_commands(segment: string): Array<string> {
	const call = git_argv.program_of(segment)

	return call === undefined ? [] : implementation_shell_nested.call_commands(call)
}

describe('implementation_shell_nested.substitution_bodies', () => {
	it.each([
		['echo $(git push)', ['git push']],
		['echo "$(git push)"', ['git push']],
		['echo `git push`', ['git push']],
		['cat <(git push)', ['git push']],
		['echo $(echo $(git push))', ['git push', 'echo  ']],
	])('reads the commands %s substitutes', (command, bodies) => {
		expect(implementation_shell_nested.substitution_bodies(command)).toEqual(bodies)
	})

	it('reads nothing in a single-quoted span', () => {
		expect(implementation_shell_nested.substitution_bodies("echo '$(git push)'")).toEqual([])
	})
})

describe('implementation_shell_nested.call_commands', () => {
	it.each([
		['xargs -0 cat', ['cat $xargs']],
		['xargs -n 1 -P 4 git push', ['git push $xargs']],
		['timeout -s KILL 5 git push', ['git push']],
		['nice -n 10 git push', ['git push']],
		['nohup gh pr close 1', ['gh pr close 1']],
		['node tools/josh/josh-ready.ts git -y', ['josh git -y']],
		['node --disable-warning=X tools/josh/josh.ts ship T', ['josh ship T']],
		['find . -name x -exec cat {} +', ['cat {}']],
		[String.raw`find . -exec git push \; -execdir rm {} +`, ['git push', 'rm {}']],
		["sh -c 'git push origin main'", ['git push origin main']],
		['bash -lc "gh pr merge 1"', ['gh pr merge 1']],
		["eval 'git push'", ['git push']],
	])('reads the commands %s launches', (segment, commands) => {
		expect(call_commands(segment)).toEqual(commands)
	})

	it.each(['xargs -0', 'find . -name x', 'bash script.sh', 'cat notes.md', 'node scripts/x.ts'])(
		'reads no command %s launches',
		(segment) => {
			expect(call_commands(segment)).toEqual([])
		},
	)
})

describe('implementation_shell_nested.reads_stdin', () => {
	it.each(['sh', 'bash -l', 'bash -s arg', 'zsh -ls'])(
		'reads %s as running its input',
		(segment) => {
			const call = git_argv.program_of(segment)

			expect(call !== undefined && implementation_shell_nested.reads_stdin(call)).toBe(true)
		},
	)

	it.each(["sh -c 'ls'", 'zsh scripts/probe.sh', 'cat'])(
		'reads %s as not running its input',
		(segment) => {
			const call = git_argv.program_of(segment)

			expect(call !== undefined && implementation_shell_nested.reads_stdin(call)).toBe(false)
		},
	)
})
