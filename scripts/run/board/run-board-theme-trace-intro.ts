import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { ThemeApi, ThemePart } from './run-board-theme-host-types'
import { run_board_theme_trace_paint } from './run-board-theme-trace-paint'
import { run_board_theme_trace_pass, type PassScene } from './run-board-theme-trace-pass'

// MATRIX's opening and ending (joshuafolkken/kit#8917), from the confirmed theme demo, after main's
// modules this change removed. The opening (run-board-intro.ts, the matrix entry of
// run-board-theme-defs.ts): on an empty screen three lead
// lines type in bright green, a letter a tick with the cursor after each, each held and erased
// after a gap; then `Knock, knock, Josh.` shows at once; then the rain reveals the board
// (run-board-reveal-rain.ts). The ending (run-board-exit-rain.ts): the reveal's rain run the other
// way — the board shows until the rain reaches it and is blank behind the tails — then the empty
// screen held a second.

const { put } = run_board_theme_host_grid
const { BRIGHT_ON } = run_board_theme_trace_paint
const { heads_of, pass, pass_ticks } = run_board_theme_trace_pass

const SECOND_TICKS = 20
const REVEAL: PassScene = {
	tail: { least: 1, spread: 1 },
	speed: { least: 0.55, spread: 0.75 },
	salt: 201,
}
const WIPE: PassScene = {
	tail: { least: 0.4, spread: 0.6 },
	speed: { least: 1.1, spread: 1.5 },
	salt: 211,
}
const LEADS: ReadonlyArray<string> = [
	'Wake up, Josh...',
	'The board has you...',
	'Follow the white rabbit.',
]
const LEAD_HOLD = 22
const LEAD_GAP = 6
const KNOCK = 'Knock, knock, Josh.'
const KNOCK_HOLD = 26

// The tick each lead starts on, and past the last the tick the knock shows.
function lead_starts(): Array<number> {
	const starts = [0]

	for (const [index, line] of LEADS.entries()) {
		starts.push((starts[index] ?? 0) + line.length + LEAD_HOLD + LEAD_GAP)
	}

	return starts
}

const LEAD_STARTS: ReadonlyArray<number> = lead_starts()
const KNOCK_FROM = LEAD_STARTS[LEADS.length] ?? 0
const REVEAL_FROM = KNOCK_FROM + KNOCK_HOLD
const ORIGIN = { y: 0, x: 0 }

// The opening's line at `tick`: a lead typing with its cursor, held, erased, then the knock.
function intro_line(tick: number): string {
	if (tick >= KNOCK_FROM) return KNOCK
	const index = LEAD_STARTS.findLastIndex((start) => tick >= start)
	const age = tick - (LEAD_STARTS[index] ?? 0)
	const line = LEADS[index] ?? ''

	if (age >= line.length + LEAD_HOLD) return ''

	return `${line.slice(0, Math.min(line.length, age + 1))}█`
}

function opening_of(api: ThemeApi, fallen: ReadonlyArray<number>): ThemePart {
	const sweep = {
		heads: heads_of(api.layout, REVEAL),
		fallen,
		shows: { ahead: false, behind: true },
	}

	return {
		ticks: REVEAL_FROM + pass_ticks(sweep, api.layout.h),
		note: 'three lead lines type and erase, Knock, knock, Josh. — then the code rain reveals the board behind its tails',
		draw(grid, tick) {
			if (tick >= REVEAL_FROM) {
				pass(grid, sweep, tick - REVEAL_FROM, api.layout.h)

				return
			}

			api.blank_screen(grid)
			put(grid, ORIGIN, intro_line(tick), BRIGHT_ON)
		},
	}
}

function ending_of(api: ThemeApi, fallen: ReadonlyArray<number>): ThemePart {
	const sweep = { heads: heads_of(api.layout, WIPE), fallen, shows: { ahead: true, behind: false } }
	const wipe_ticks = pass_ticks(sweep, api.layout.h)

	return {
		ticks: wipe_ticks + SECOND_TICKS,
		note: 'the code rain wipes the board away, twice the reveal’s pace, then a second of empty screen',
		draw(grid, tick) {
			if (tick >= wipe_ticks) api.blank_screen(grid)
			else pass(grid, sweep, tick, api.layout.h)
		},
	}
}

const run_board_theme_trace_intro = { ending_of, intro_line, opening_of }

export { run_board_theme_trace_intro }
