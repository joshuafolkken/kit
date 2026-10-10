// How `josh run:board` puts its frames on the terminal. A board kept open
// draws on the alternate screen, as `top` and `less` do: clearing the normal screen pushes every
// redraw into the scrollback, so the board would grow like a log. Leaving restores the screen and the
// cursor the person had. One frame — `--once`, or a pipe — draws no screen control; a terminal still
// gets its colors.

type ScreenMode = 'live' | 'plain'

// The control bytes written on entering, before each frame, and on leaving.
interface Screen {
	enter: string
	frame: string
	leave: string
}

const ESC = '\u{1B}['
const ALTERNATE_SCREEN_ON = `${ESC}?1049h`
const ALTERNATE_SCREEN_OFF = `${ESC}?1049l`
const CURSOR_HIDE = `${ESC}?25l`
const CURSOR_SHOW = `${ESC}?25h`
const CURSOR_HOME = `${ESC}H`
const ERASE_BELOW = `${ESC}J`

const LIVE: Screen = {
	enter: `${ALTERNATE_SCREEN_ON}${CURSOR_HIDE}`,
	frame: `${CURSOR_HOME}${ERASE_BELOW}`,
	leave: `${CURSOR_SHOW}${ALTERNATE_SCREEN_OFF}`,
}

const PLAIN: Screen = { enter: '', frame: '', leave: '' }

function mode_of(options: { is_tty: boolean; is_once: boolean }): ScreenMode {
	return options.is_tty && !options.is_once ? 'live' : 'plain'
}

function screen_of(mode: ScreenMode): Screen {
	return mode === 'live' ? LIVE : PLAIN
}

const run_board_screen = { mode_of, screen_of }

export { run_board_screen }
export type { Screen, ScreenMode }
