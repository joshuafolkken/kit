// **One reading of a shell line's words and control operators, shared by the guards** (joshuafolkken/kit#7334).
// A guard that cuts the line with a separator pattern of its own can read the same line differently
// from the next one, so the cut starts here. The tokenizer is hand-written rather than a parser package: the guards slice the
// typed line at a token's offsets, and the candidate packages return argv with the quotes removed and
// the variables expanded, so no offset survives (`docs/maintainers/shell-tokenizer.md`).
//
// **Quoting is the caller's reading, not this file's.** A caller that must not cut inside quotes hands
// in the quote-blanked line (`time_shell.blanked`), whose offsets are the typed line's; a caller that
// reads quoted text as commands too hands in the line as typed. `words_of` is the one reading of a
// command's words for the guards that read arguments rather than cut commands.

import { time_shell } from '#scripts/time-runtime/time-shell'

type ShellTokenKind = 'operator' | 'word'

interface ShellToken {
	begin: number
	end: number
	kind: ShellTokenKind
	text: string
}

// Longest first, so `;;&` and `;;` (a `case` arm's end) are one operator, not two `;`. A `|` after `>`
// is the clobber redirect, and a `&` beside `<` or `>` belongs to a redirection (`2>&1`, `&>f`, `<&3`).
const OPERATOR = String.raw`;;&?|;&|&&|\|\||(?<!>)\|&?|;|\n|(?<![<>])&(?!>)`
const WORD = String.raw`(?:[^\s;&|]|(?<=[<>])&|&(?=>)|(?<=>)\|)+`
const TOKEN_PATTERN = new RegExp(`(?<operator>${OPERATOR})|${WORD}`, 'gu')
// A separator character the quote-held reading turns into a word character where a quote holds it.
const SEPARATOR = /[;&|]/gu
const HELD = '_'
const BLANK = ' '

/** The line's tokens in order, each with its offsets; whitespace other than a newline separates them. */
function tokens_of(reading: string): Array<ShellToken> {
	return [...reading.matchAll(TOKEN_PATTERN)].map((match) => ({
		begin: match.index,
		end: match.index + match[0].length,
		kind: match.groups?.['operator'] === undefined ? 'word' : 'operator',
		text: match[0],
	}))
}

// The line with each `;`, `&` or `|` a quote or a backslash holds made a word character; the quote-blanked
// line has the typed line's offsets. A heredoc line, which `blanked` does not read, stays as typed.
function quote_held(line: string): string {
	const plain = time_shell.blanked(line)
	if (plain === undefined) return line

	return line.replaceAll(SEPARATOR, (character, offset: number) =>
		plain[offset] === BLANK ? HELD : character,
	)
}

/**
 * The line's words, each with its typed text: whitespace cuts a word as it does unquoted, but a
 * separator inside quotes stays in its word (`rg "a|b" f` is three words).
 */
function words_of(line: string): Array<ShellToken> {
	return tokens_of(quote_held(line))
		.filter((token) => token.kind === 'word')
		.map((token) => ({ ...token, text: line.slice(token.begin, token.end) }))
}

const shell_tokens = { tokens_of, words_of }

export { shell_tokens, type ShellToken }
