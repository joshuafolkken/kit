import { time_shell } from '#scripts/time-runtime/time-shell'
import { nested_commands } from './nested-commands'

// The files a shell segment's redirects name, used by `protected-files.ts` to detect secrets read or
// written.
//
// Each `<` of a redirect operator is spaced out to the read mark and each `>` (the clobber `>|` whole)
// to the write mark, so the word after the last mark of `<`, `>`, `>>`, `2>` or `&>` is the file it
// reads or writes. A quoted `>` is text (`git commit -m "x >> .env"`), so the marks are read on the
// quote-blanked segment, whose offsets match the original; a shell's quoted script
// (`sh -c "echo x > .env"`) runs, so its marks are read as written, as is a heredoc line, which
// `blanked` does not cut.

// The marks are words no command line carries, so a quoted `>` left as text is never read as one.
const READ_MARK = '\u{1}read'
const WRITE_MARK = '\u{1}write'
const READ_OPERATOR = '<'
const REDIRECT = />\||[<>]/gu
const WHITESPACE = /\s+/u
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

function marked_words(segment: string, program: string | undefined): Array<string> {
	const marks = redirect_marks_of(segment, program)
	const spaced = segment.replaceAll(REDIRECT, (operator, offset: number) =>
		marks.startsWith(operator, offset) ? ` ${mark_of(operator)} ` : operator,
	)

	return spaced.split(WHITESPACE).filter((word) => word !== '')
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
