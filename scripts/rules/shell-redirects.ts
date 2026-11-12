import { time_shell } from '#scripts/time-runtime/time-shell'
import { nested_commands } from './nested-commands'
import { shell_tokens, type ShellToken } from './shell-tokens'

// The files a shell segment's redirects name, used by `protected-files.ts` to detect secrets read or
// written.
//
// The segment's words are the shared tokenizer's (`shell_tokens.words_of`). Within each word, each `<`
// of a redirect operator is cut out as the read mark and each `>` (the clobber `>|` whole) as the
// write mark, so the piece after the last mark of `<`, `>`, `>>`, `2>` or `&>` is the file it
// reads or writes. A quoted `>` is text (`git commit -m "x >> .env"`), so the marks are read on the
// quote-blanked segment, whose offsets match the original; a shell's quoted script
// (`sh -c "echo x > .env"`) runs, so its marks are read as written, as is a heredoc line, which
// `blanked` does not cut.

// The marks are words no command line carries, so a quoted `>` left as text is never read as one.
const READ_MARK = '\u{1}read'
const WRITE_MARK = '\u{1}write'
const READ_OPERATOR = '<'
const REDIRECT = />\||[<>]/gu
// Cuts a word around its marks; like the marks, no command line carries it.
const PIECE_END = '\u{0}'
const NEXT = 1
const ANY_MARK: ReadonlySet<string> = new Set([READ_MARK, WRITE_MARK])
const { SHELLS } = nested_commands

function redirect_marks_of(segment: string, program: string | undefined): string {
	if (program !== undefined && SHELLS.has(program)) return segment

	return time_shell.blanked(segment) ?? segment
}

function mark_of(operator: string): string {
	return operator === READ_OPERATOR ? READ_MARK : WRITE_MARK
}

// One word's pieces: each operator the reading marks becomes a piece of its own, so `2>&1` is `2`, a
// write mark and `&1`, and `cat<in.txt` reads `in.txt`.
function marked_pieces(word: ShellToken, marks: string): Array<string> {
	const pieced = word.text.replaceAll(REDIRECT, (operator, offset: number) =>
		marks.startsWith(operator, word.begin + offset)
			? `${PIECE_END}${mark_of(operator)}${PIECE_END}`
			: operator,
	)

	return pieced.split(PIECE_END).filter((piece) => piece !== '')
}

function marked_words(segment: string, program: string | undefined): Array<string> {
	const marks = redirect_marks_of(segment, program)

	return shell_tokens.words_of(segment).flatMap((word) => marked_pieces(word, marks))
}

// Every file the segment's redirects read or write.
function targets_of(segment: string, program: string | undefined): Array<string> {
	const words = marked_words(segment, program)

	return words
		.map((word, index) => (ANY_MARK.has(word) ? words[index + NEXT] : undefined))
		.filter((target): target is string => target !== undefined && !ANY_MARK.has(target))
}

const shell_redirects = { targets_of }

export { shell_redirects }
