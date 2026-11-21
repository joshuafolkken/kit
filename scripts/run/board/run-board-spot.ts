import { run_board_fit } from './run-board-fit'

// The placeholder a live `run:board` frame is rendered with where a spinner goes, and a line drawn with
// a spinner frame in each. A private-use character one column wide, as a spinner frame is, so the frame
// is fitted the same. `TICK` marks the third line's age `″` the sweep is placed under (joshuafolkken/kit#8240)
// and is drawn back as `″`, one column wide too. `LAMP_START` marks where a throughput row's lamp panel
// starts and `LAMP` one lamp of it, drawn as `■` (joshuafolkken/kit#8236).

const SPOT = '\u{E000}'
// Past the row key's markers (`run-board-row-key.ts`), so a keyed line's split never takes it for one.
const TICK = '\u{E003}'
const LAMP_START = '\u{E004}'
const LAMP = '\u{E005}'
const TRACE = '\u{E006}'
const SECONDS_MARK = '″'
const LAMP_MARK = '■'
// eslint-disable-next-line no-control-regex -- the color escapes a spot keeps are control characters
const SGR = /\u{1B}\[[\d;]*m/gu

// Where one placeholder is on screen, 1-based, and the colors in effect where it is drawn.
interface Spot {
	row: number
	column: number
	style: string
}

// The spot of the placeholder at `index` in a line that starts `row` rows down the screen.
function spot_at(line: string, index: number, row: number, columns: number): Spot {
	const before = line.slice(0, index)
	const width = run_board_fit.width_of(before)
	const style = (before.match(SGR) ?? []).join('')

	return { row: row + Math.floor(width / columns), column: (width % columns) + 1, style }
}

function drawn(line: string, frame: string): string {
	return line
		.split(SPOT)
		.join(frame)
		.split(TICK)
		.join(SECONDS_MARK)
		.split(LAMP)
		.join(LAMP_MARK)
		.split(TRACE)
		.join('T')
}

const run_board_spot = {
	LAMP,
	LAMP_MARK,
	LAMP_START,
	SECONDS_MARK,
	SPOT,
	TICK,
	TRACE,
	drawn,
	spot_at,
}

export { run_board_spot }
export type { Spot }
