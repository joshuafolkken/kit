// One word for a POSIX shell, in single quotes, so a `$`, a backtick or a `"` in it is never expanded
// or ends the word: a quote inside closes the word, adds an escaped quote and reopens it.

const QUOTE = "'"
const ESCAPED_QUOTE = String.raw`'\''`

function single_quoted(text: string): string {
	return QUOTE + text.split(QUOTE).join(ESCAPED_QUOTE) + QUOTE
}

// A token of only these characters means the same to the shell quoted or not, so it is left bare.
const BARE_WORD = /^[\w%+,./:=@-]+$/u

// `token` as one shell word: bare when quoting would change nothing, single-quoted otherwise.
function word(token: string): string {
	return BARE_WORD.test(token) ? token : single_quoted(token)
}

const shell_quote = { single_quoted, word }

export { shell_quote }
