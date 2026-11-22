import { run_board_escape } from './run-board-escape'

// joshuafolkken/kit#7988: the WarGames theme draws the board's text in capitals, as a text terminal
// does. Only the text between escapes is changed: a color's final `m`, a cursor move's `H`, an OSC 8
// link's URL and tmux's passthrough wrapping it (joshuafolkken/kit#8567) keep their case. Only ASCII
// letters change, so no character changes its width.

const LOWERCASE_RUN = /[a-z]+/gu

function ascii_capitals(text: string): string {
	return text.replaceAll(LOWERCASE_RUN, (run: string) => run.toUpperCase())
}

function capitals(frame: string): string {
	return frame
		.split(run_board_escape.FRAME_ESCAPE)
		.map((part) => (run_board_escape.is_escape(part) ? part : ascii_capitals(part)))
		.join('')
}

const run_board_theme_case = { capitals }

export { run_board_theme_case }
