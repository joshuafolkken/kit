// One word for a POSIX shell, in single quotes, so a `$`, a backtick or a `"` in it is never expanded
// or ends the word: a quote inside closes the word, adds an escaped quote and reopens it.

const QUOTE = "'"
const ESCAPED_QUOTE = String.raw`'\''`

function single_quoted(text: string): string {
	return QUOTE + text.split(QUOTE).join(ESCAPED_QUOTE) + QUOTE
}

const shell_quote = { single_quoted }

export { shell_quote }
