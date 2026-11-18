// One beat of a line being typed: the part typed so far, trailed by a block that reads as a cursor
// while typing goes on and is gone once the whole line is out. The caller cuts `shown`, so a colored
// line cut with its colors kept reads the same.

const CURSOR = '█'

function typed(text: string, shown: string): string {
	if (shown === text) return shown

	return `${shown}${CURSOR}`
}

const run_board_typing = { CURSOR, typed }

export { run_board_typing }
