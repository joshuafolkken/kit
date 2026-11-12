import { describe, expect, it } from 'vitest'
import { shell_tokens } from './shell-tokens'

// joshuafolkken/kit#7334: the one reading of a line's words and control operators the guards cut on.

function texts_of(reading: string): Array<string> {
	return shell_tokens.tokens_of(reading).map((token) => token.text)
}

function operators_of(reading: string): Array<string> {
	return shell_tokens
		.tokens_of(reading)
		.filter((token) => token.kind === 'operator')
		.map((token) => token.text)
}

describe('tokens_of', () => {
	it.each([
		['a && b || c', ['&&', '||']],
		['a; b\nc', [';', '\n']],
		['a | b |& c & d', ['|', '|&', '&']],
		['a;; b;;& c;& d', [';;', ';;&', ';&']],
	])('reads the control operators of %j', (reading, expected) => {
		expect(operators_of(reading)).toStrictEqual(expected)
	})

	it.each([
		['a 2>&1', ['a', '2>&1']],
		['a &> log', ['a', '&>', 'log']],
		['a <&3', ['a', '<&3']],
		['a >| f', ['a', '>|', 'f']],
	])('keeps the `&` or `|` of a redirection in its word: %j', (reading, expected) => {
		expect(texts_of(reading)).toStrictEqual(expected)
		expect(operators_of(reading)).toStrictEqual([])
	})

	it('gives each token the offsets it has in the line', () => {
		const reading = 'ab  && c'

		expect(shell_tokens.tokens_of(reading)).toStrictEqual([
			{ begin: 0, end: 2, kind: 'word', text: 'ab' },
			{ begin: 4, end: 6, kind: 'operator', text: '&&' },
			{ begin: 7, end: 8, kind: 'word', text: 'c' },
		])
	})
})

function words_of(line: string): Array<string> {
	return shell_tokens.words_of(line).map((word) => word.text)
}

// joshuafolkken/kit#7338: the word reading the argument readers moved onto.
describe('words_of', () => {
	it.each([
		['rg "a|b" short.ts', ['rg', '"a|b"', 'short.ts']],
		[String.raw`echo a\;b 'c&d'`, ['echo', String.raw`a\;b`, "'c&d'"]],
		['echo x 2>&1 >| out', ['echo', 'x', '2>&1', '>|', 'out']],
	])('keeps a quoted separator and a redirection in its word: %j', (line, expected) => {
		expect(words_of(line)).toStrictEqual(expected)
	})

	// A quoted space still cuts, as the readers that split on whitespace did.
	it('cuts a word at a quoted space', () => {
		expect(words_of('grep "a b" f')).toStrictEqual(['grep', '"a', 'b"', 'f'])
	})

	it('reads a heredoc line as typed', () => {
		expect(words_of('cat <<EOF\na|b\nEOF')).toStrictEqual(['cat', '<<EOF', 'a', 'b', 'EOF'])
	})

	it('gives each word its offsets in the line', () => {
		expect(shell_tokens.words_of('a "b;c"')).toStrictEqual([
			{ begin: 0, end: 1, kind: 'word', text: 'a' },
			{ begin: 2, end: 7, kind: 'word', text: '"b;c"' },
		])
	})
})
