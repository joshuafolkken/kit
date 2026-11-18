// The placeholder a live `run:board` frame is rendered with where a spinner goes, and a line drawn with
// a spinner frame in each. A private-use character one column wide, as a spinner frame is, so the frame
// is fitted the same.

const SPOT = '\u{E000}'

function drawn(line: string, frame: string): string {
	return line.split(SPOT).join(frame)
}

const run_board_spot = { SPOT, drawn }

export { run_board_spot }
