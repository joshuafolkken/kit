// One beat of a line being typed: the part typed so far, trailed by a block that reads as a cursor
// while typing goes on and is gone once the whole line is out. The caller cuts `shown`, so a colored
// line cut with its colors kept reads the same.
// joshuafolkken/kit#8397: given the clock, the block blinks — lit for one `BLINK_MS` beat, a blank for
// the next — so every row typing at once blinks on the same beat; without it (the opening) it stays lit.

const CURSOR = '█'
const BLINK_MS = 150
const BLINK_OFF = ' '
const BLINK_PHASES = [CURSOR, BLINK_OFF] as const

function cursor_at(now_ms: number | undefined): string {
	if (now_ms === undefined) return CURSOR

	return BLINK_PHASES[Math.floor(now_ms / BLINK_MS) % BLINK_PHASES.length] ?? CURSOR
}

function typed(text: string, shown: string, now_ms?: number): string {
	if (shown === text) return shown

	return `${shown}${cursor_at(now_ms)}`
}

const run_board_typing = { BLINK_MS, CURSOR, typed }

export { run_board_typing }
