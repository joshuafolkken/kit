// joshuafolkken/kit#8567: the escapes a drawn board line carries, recognized in one place. A color
// (SGR), a link (OSC 8, ended by BEL or ST) and, inside tmux, a link wrapped in tmux's DCS passthrough
// (a DCS opened by `ESC P` and `tmux;`, ended by `ESC \`, every inner ESC doubled — `terminal-link` writes it when `$TMUX` is set) take
// no column, and none of their bytes is the board's text.

const ESC = '\u{1B}'
const BEL = '\u{7}'
// A DCS sequence's opening: tmux's passthrough is one.
const DCS = `${ESC}P`
const TMUX_START = `${DCS}tmux;`
const TMUX_END = `${ESC}\\`
const DOUBLED_ESC = `${ESC}${ESC}`
const LINK_START = `${ESC}]8;`
const LINK_CLOSE = `${ESC}]8;;${BEL}`
// A link's closing escape: one with no URI, ended by BEL or ST.
const LINK_CLOSE_ENDS = [`;${BEL}`, `;${ESC}\\`]

const SGR = String.raw`${ESC}\[[\d;]*m`
const LINK = String.raw`${ESC}\]8;[^${BEL}${ESC}]*(?:${BEL}|${ESC}\\)`
const PASSTHROUGH = String.raw`${TMUX_START}(?:[^${ESC}]|${DOUBLED_ESC})*${ESC}\\`
// Any CSI sequence (a cursor move as well as a color), any OSC, and an escape of one character after
// its ESC (ESC 7) — the ones a whole frame carries besides a line's.
const CSI = String.raw`${ESC}\[[0-?]*[ -/]*[@-~]`
const OSC = String.raw`${ESC}\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\)?`
const SHORT = String.raw`${ESC}[\s\S]?`

// A line's escapes, captured, so a split keeps them.
const LINE_ESCAPE = new RegExp(`(${PASSTHROUGH}|${SGR}|${LINK})`, 'u')
// A frame's escapes, captured, so a split keeps them.
const FRAME_ESCAPE = new RegExp(`(${PASSTHROUGH}|${CSI}|${OSC}|${SHORT})`, 'u')

function is_escape(part: string): boolean {
	return part.startsWith(ESC)
}

// The escape tmux's passthrough carries, its doubled ESCs single again; any other escape as it is.
function unwrapped(escape: string): string {
	if (!escape.startsWith(TMUX_START)) return escape

	return escape.slice(TMUX_START.length, -TMUX_END.length).replaceAll(DOUBLED_ESC, () => ESC)
}

function is_link(escape: string): boolean {
	return unwrapped(escape).startsWith(LINK_START)
}

// Whether a link's escape opens a link rather than closes one.
function is_link_open(escape: string): boolean {
	const link = unwrapped(escape)

	return link.startsWith(LINK_START) && LINK_CLOSE_ENDS.every((end) => !link.endsWith(end))
}

// The escape closing the link `open` opens, wrapped for tmux as `open` is.
function link_close_for(open: string): string {
	if (!open.startsWith(TMUX_START)) return LINK_CLOSE

	const doubled = LINK_CLOSE.replaceAll(ESC, () => DOUBLED_ESC)

	return `${TMUX_START}${doubled}${TMUX_END}`
}

const run_board_escape = {
	FRAME_ESCAPE,
	LINE_ESCAPE,
	LINK_CLOSE,
	is_escape,
	is_link,
	is_link_open,
	link_close_for,
}

export { run_board_escape }
