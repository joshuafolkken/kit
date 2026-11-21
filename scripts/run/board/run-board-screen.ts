// How `josh run:board` puts its frames on the terminal. A board kept open
// draws on the alternate screen, as `top` and `less` do: clearing the normal screen pushes every
// redraw into the scrollback, so the board would grow like a log. Leaving restores the screen and the
// cursor the person had. One frame — `--once`, or a pipe — draws no screen control; a terminal still
// gets its colors.

type ScreenMode = 'live' | 'plain'

// The control bytes written on entering and on leaving, and each frame as written: `frame` in one
// synchronized write, `held` without it for the first frame, revealed a block at a time.
interface Screen {
	enter: string
	frame: (text: string) => string
	held: (text: string) => string
	leave: string
}

const ESC = '\u{1B}['
const ALTERNATE_SCREEN_ON = `${ESC}?1049h`
const ALTERNATE_SCREEN_OFF = `${ESC}?1049l`
const CURSOR_HIDE = `${ESC}?25l`
const CURSOR_SHOW = `${ESC}?25h`
const CURSOR_HOME = `${ESC}H`
const ERASE_BELOW = `${ESC}J`
const ERASE_LINE = `${ESC}K`
const SYNC_ON = `${ESC}?2026h`
const SYNC_OFF = `${ESC}?2026l`

// joshuafolkken/kit#8125: bytes a terminal draws only once all have arrived (DEC 2026), so no
// half-written state shows; a terminal without it ignores the markers. Nothing to write stays nothing.
function synced(text: string): string {
	if (text === '') return ''

	return `${SYNC_ON}${text}${SYNC_OFF}`
}

// A frame over the last one, never a cleared screen: each line erased as it is written, the last
// erasing every row below too, so a shorter frame leaves none of the longer one. Each erase leads its
// line — one after a line that fills the row would take the line's last character with it.
function overwritten(text: string): string {
	const lines = text.split('\n')
	const last = lines.length - 1
	const erased = lines.map((line, index) => `${index === last ? ERASE_BELOW : ERASE_LINE}${line}`)

	return `${CURSOR_HOME}${erased.join('\n')}`
}

function overwritten_synced(text: string): string {
	return synced(overwritten(text))
}

// The first frame, revealed a block at a time over the intro's typed line: the screen wiped first,
// whatever the intro left (joshuafolkken/kit#8000), and nothing held back by synchronized output.
function wiped(text: string): string {
	return `${CURSOR_HOME}${ERASE_BELOW}${text}`
}

function unchanged(text: string): string {
	return text
}

const LIVE: Screen = {
	enter: `${ALTERNATE_SCREEN_ON}${CURSOR_HIDE}`,
	frame: overwritten_synced,
	held: wiped,
	leave: `${CURSOR_SHOW}${ALTERNATE_SCREEN_OFF}`,
}

const PLAIN: Screen = { enter: '', frame: unchanged, held: unchanged, leave: '' }

function mode_of(options: { is_tty: boolean; is_once: boolean }): ScreenMode {
	return options.is_tty && !options.is_once ? 'live' : 'plain'
}

function screen_of(mode: ScreenMode): Screen {
	return mode === 'live' ? LIVE : PLAIN
}

const run_board_screen = { mode_of, screen_of, synced }

export { run_board_screen }
export type { Screen, ScreenMode }
