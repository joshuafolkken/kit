// joshuafolkken/kit#7988: the WarGames theme draws the board's text in capitals, as a text terminal
// does. Only the text between escapes is changed: a color's final `m`, a cursor move's `H` and an OSC 8
// link's URL keep their case. Only ASCII letters change, so no character changes its width.

const ESC = '\u{1B}'
const BEL = '\u{7}'
const OSC_START = ']'
// The rest of a CSI sequence after its ESC: parameters, intermediates, the final byte.
const CSI_BODY = /^\[[0-?]*[ -/]*[@-~]/u
const LOWERCASE_RUN = /[a-z]+/gu
// An escape no CSI or OSC opens (ESC 7, an OSC's `ESC \` terminator) is one character after its ESC.
const SHORT_ESCAPE = 1

function ascii_capitals(text: string): string {
	return text.replaceAll(LOWERCASE_RUN, (run: string) => run.toUpperCase())
}

// How much of what follows an ESC is the escape. An OSC 8 link ends at BEL, else at the ESC of its
// `ESC \` terminator, which opens the next segment.
function escape_length(segment: string): number {
	if (!segment.startsWith(OSC_START)) return CSI_BODY.exec(segment)?.[0].length ?? SHORT_ESCAPE
	const end = segment.indexOf(BEL)

	return end === -1 ? segment.length : end + 1
}

function after_escape(segment: string): string {
	const length = escape_length(segment)

	return segment.slice(0, length) + ascii_capitals(segment.slice(length))
}

function capitals(frame: string): string {
	const [head = '', ...escaped] = frame.split(ESC)

	return [ascii_capitals(head), ...escaped.map((segment) => after_escape(segment))].join(ESC)
}

const run_board_theme_case = { capitals }

export { run_board_theme_case }
