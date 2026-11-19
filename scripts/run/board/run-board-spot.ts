// The placeholder a live `run:board` frame is rendered with where a spinner goes, and a line drawn with
// a spinner frame in each. A private-use character one column wide, as a spinner frame is, so the frame
// is fitted the same. `TICK` marks the third line's age `″` the sweep is placed under (joshuafolkken/kit#8240)
// and is drawn back as `″`, one column wide too.

const SPOT = '\u{E000}'
// Past the row key's markers (`run-board-row-key.ts`), so a keyed line's split never takes it for one.
const TICK = '\u{E003}'
const SECONDS_MARK = '″'

function drawn(line: string, frame: string): string {
	return line.split(SPOT).join(frame).split(TICK).join(SECONDS_MARK)
}

const run_board_spot = { SECONDS_MARK, SPOT, TICK, drawn }

export { run_board_spot }
