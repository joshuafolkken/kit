import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_trace_data, type TraceView } from './run-board-theme-trace-data'
import { run_board_theme_trace_paint } from './run-board-theme-trace-paint'

// MATRIX's TRACE gauge and its rules (joshuafolkken/kit#8917), from the confirmed theme demo.

const { fg, level_x, put, repeated, restyle } = run_board_theme_host_grid
const { NOTICE_END, TICK_MS, active } = run_board_theme_host_state
const { RED, SHADE } = run_board_theme_trace_data
const { BRIGHT_ON, DARK_ON, paint } = run_board_theme_trace_paint

// TRACE where wargames shows DEFCON: `TRACE ` and five cells, 6 - level of them filled.
const WORD = 'TRACE '
const FULL = `${WORD}■■■■■`
const LEVEL = { calm: 5, steps: 4, top: 6, alarm: 1 }
// At level 1 its first character blinks: lit for the first part of each beat.
const BLINK = { beat_ms: 560, lit_ms: 350 }

// The level: calm until a notice, climbing as it builds, 1 from its peak to the effect's end.
function trace_level(state: ThemeState): number {
	const { notice } = state

	if (notice.index < 0 || !active(notice, NOTICE_END)) return LEVEL.calm
	if (notice.is_typing) return LEVEL.calm - Math.floor((LEVEL.steps * notice.length) / notice.total)

	return LEVEL.alarm
}

// The gauge's first column: flush to the rule's right end, as every theme's level sits
// (`run-board-theme-host-grid.ts` level_x) — the demo drew it from the level spot's left end instead.
function gauge_x(view: TraceView): number {
	return level_x(view.layout.level_spot, FULL.length)
}

function alarm_gauge(view: TraceView): void {
	const { y } = view.layout.level_spot
	const x = gauge_x(view)
	const is_lit = (view.tick * TICK_MS) % BLINK.beat_ms < BLINK.lit_ms

	put(view.grid, { y, x }, FULL, fg(RED))
	put(view.grid, { y, x }, 'T', fg(is_lit ? RED : SHADE.darkest))
}

// TRACE climbs as a notice builds, and at level 1 is all red, its first character blinking: the
// board's real level where the host gives one, else the theme's own.
function trace_gauge(view: TraceView): void {
	const level = view.s.event.level ?? trace_level(view.s)
	const { y } = view.layout.level_spot
	const x = gauge_x(view)

	put(view.grid, { y, x: x - 1 }, ' ', 'rule')

	if (level === LEVEL.alarm) {
		alarm_gauge(view)

		return
	}

	put(view.grid, { y, x }, WORD, paint(SHADE.mid))
	put(view.grid, { y, x: x + WORD.length }, repeated('■', LEVEL.top - level), BRIGHT_ON)
	put(view.grid, { y, x: x + WORD.length + LEVEL.top - level }, repeated('-', level - 1), DARK_ON)
}

// Rule dashes in dark, the rule's words in mid.
function dark_dashes(grid: Grid): void {
	restyle(
		grid,
		([ch, style]) => style.startsWith('rule') && ch === '-',
		() => DARK_ON,
	)
}

const run_board_theme_trace_gauge = { dark_dashes, trace_gauge, trace_level }

export { run_board_theme_trace_gauge }
