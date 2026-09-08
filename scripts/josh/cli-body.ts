import { readFileSync } from 'node:fs'

// A body — an Issue comment, a PR comment, a notification message — handed to a command as an inline
// double-quoted shell argument is **evaluated by the shell before the command ever sees it**
// (joshuafolkken/kit#1198). The observed damage is not a mangled string: a PR comment posted with
// `gh api … -f body="… \`pnpm josh ms\` …"` had part of its own text run as git commands, which
// switched a lane's work tree onto `main` and stopped the run.
//
// So every command that takes a body offers a path-shaped way in, and this module is the one that
// reads it. It exists as a module rather than per entry point because `epic-cli.ts` already had the
// reader for `--rationale-file` / `--decision-file`, and a second copy is the clone `CLAUDE.md`
// prohibits — in the one place where two copies would disagree about what `-` means.

// `-` reads stdin, matching `gh issue create --body-file -`. Shared by every `*-file` flag rather
// than spelled out per flag, so the stdin form cannot come to mean one thing under one and something
// else under another.
const STDIN_PATH = '-'
const STDIN_FD = 0

// The escape a caller writes when the body has to stay one shell token. It is expanded for the
// **inline** form only: a file already holds real newlines, and expanding there would rewrite a
// literal backslash-n that the author put in the body on purpose.
const ESCAPED_NEWLINE = String.raw`\n`

function read_file_or_stdin(path: string): string {
	return readFileSync(path === STDIN_PATH ? STDIN_FD : path, 'utf8')
}

function expand_escaped_newlines(raw: string): string {
	return raw.replaceAll(ESCAPED_NEWLINE, '\n')
}

// A flag counts as given only when it carries text, so `--body ''` is not an answer.
function has_value(raw: string | undefined): boolean {
	return raw !== undefined && raw.length > 0
}

// The inline half, kept apart so `resolve` reads as the one decision it makes: file or not.
function resolve_inline(inline: string | undefined): string | undefined {
	return inline === undefined ? undefined : expand_escaped_newlines(inline)
}

// **Both flags at once is refused rather than ranked.** A precedence rule would let a caller that
// meant the file silently ship the inline string it was trying to get away from, which is the exact
// failure this option exists to remove.
function resolve(input: {
	inline: string | undefined
	file_path: string | undefined
	inline_flag: string
	file_flag: string
}): string | undefined {
	const { inline, file_path } = input

	if (file_path === undefined || file_path.length === 0) return resolve_inline(inline)

	if (has_value(inline)) {
		throw new Error(`Pass ${input.inline_flag} or ${input.file_flag}, not both.`)
	}

	return read_file_or_stdin(file_path)
}

const cli_body = { read_file_or_stdin, expand_escaped_newlines, has_value, resolve }

export { cli_body }
