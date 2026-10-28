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

// joshuafolkken/kit#4923: a printed path is quoted only when the shell would read it otherwise.
describe('shell_quote.word', () => {
	it.each(['scripts/lib/shell-quote.ts', '4923', '--review', 'a@b:c=d,e+f%g'])(
		'leaves a token the shell reads as is bare: %s',
		(token) => {
			expect(shell_quote.word(token)).toBe(token)
		},
	)

	it.each(['src/routes/(app)/+layout.svelte', 'src/routes/[slug]/+page.ts', 'a b', ''])(
		'quotes a token the shell would split or expand: %s',
		(token) => {
			expect(shell_quote.word(token)).toBe(shell_quote.single_quoted(token))
		},
	)
})
