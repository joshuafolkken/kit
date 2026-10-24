import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { shell_quote } from './shell-quote'

// joshuafolkken/kit#4821: the one single-quoting helper every printed shell command uses.

function echoed(text: string): string {
	return execFileSync('sh', ['-c', `printf %s ${shell_quote.single_quoted(text)}`], {
		encoding: 'utf8',
	})
}

describe('shell_quote.single_quoted', () => {
	it('single-quotes a title so the shell expands nothing in it', () => {
		expect(shell_quote.single_quoted('Fix `$HOME` #1')).toBe("'Fix `$HOME` #1'")
	})

	it('escapes a single quote inside the title', () => {
		expect(shell_quote.single_quoted("Don't #1")).toBe(String.raw`'Don'\''t #1'`)
	})

	it.each(['Teach `josh gate` to stop', 'cost $(date) $HOME', 'say "hi"', "it's here", ''])(
		'reaches the shell unchanged: %s',
		(text) => {
			expect(echoed(text)).toBe(text)
		},
	)
})
