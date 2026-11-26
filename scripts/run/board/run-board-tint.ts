import { run_board_labels, type Paint } from './run-board-labels'

// A color laid over text a render module gave no color: the base look's own over a whole line
// (`run-board-theme.ts`) — a color the frame gave is kept, the tint resumed after it.

const DASH = '-'
// The escapes that end a color and fall back to the terminal's default foreground: the default
// foreground itself, and a reset.
const DEFAULT_FOREGROUND = '\u{1B}[39m'
const RESET = '\u{1B}[0m'

// The escape that opens `paint`, as `painted` draws it — `''` where stdout draws no color, so a tint
// draws no escape where the board's own colors would not.
function open_of(paint: Paint): string {
	const sample = run_board_labels.painted(paint, DASH)

	return sample.slice(0, sample.indexOf(DASH))
}

// `line` with `open` over every part no color is given, the default foreground after it.
function lit(open: string, line: string): string {
	if (open === '' || line === '') return line

	const resumed = line
		.split(DEFAULT_FOREGROUND)
		.join(open)
		.split(RESET)
		.join(RESET + open)

	return open + resumed + DEFAULT_FOREGROUND
}

const run_board_tint = { lit, open_of }

export { run_board_tint }
