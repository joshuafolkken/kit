import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid, ThemeState } from './run-board-theme-host-types'

// The theme host's NOTICE beats (joshuafolkken/kit#8917), ported from the confirmed theme demo: the
// trace's bar over the notice text, the start's three flashes and the peak's two sparks.

const { BOLD, bg, fg, restyle } = run_board_theme_host_grid
const { TRACE_END, TRACE_EVERY, TRACE_ON } = run_board_theme_host_state

const TRACE_INK = fg('10;10;10')
// The start flashes on every other tick for six ticks; the peak sparks on every other for four.
const FLASH_BEAT = 2
const START_TICKS = 6
const PEAK_SPARK_TICKS = 4

// Whether the trace's bar is lit: effects that pulse after the peak pulse with it.
function trace_on(state: ThemeState): boolean {
	const { notice } = state

	return (
		notice.index >= 0 &&
		!notice.is_typing &&
		notice.cooled < TRACE_END &&
		notice.cooled % TRACE_EVERY < TRACE_ON
	)
}

// The bar, in `color`, over the notice text and the cell before it.
function notice_trace(grid: Grid, state: ThemeState, color: string): void {
	if (!trace_on(state)) return
	const { span, total } = state.notice_text

	restyle(
		grid,
		(_, x, y) => y === span.y && x >= span.x - 1 && x <= span.x + total,
		() => `${TRACE_INK}${BOLD}${bg(color)}`,
	)
}

// A NOTICE starting: the whole screen flashes three times.
function start_flash(grid: Grid, state: ThemeState, tick: number, style: string): void {
	const age = tick - state.notice.start

	if (state.notice.index < 0 || age >= START_TICKS || age % FLASH_BEAT !== 0) return
	restyle(
		grid,
		() => true,
		() => style,
	)
}

function is_sparking(state: ThemeState): boolean {
	const { notice } = state

	return notice.index >= 0 && !notice.is_typing && notice.cooled < PEAK_SPARK_TICKS
}

// A NOTICE peaking, as the trace's first bar lights: the whole screen sparks twice.
function peak_flash(grid: Grid, state: ThemeState, style: string): void {
	if (!is_sparking(state) || state.notice.cooled % FLASH_BEAT !== 0) return
	restyle(
		grid,
		() => true,
		() => style,
	)
}

const run_board_theme_host_flash = { notice_trace, peak_flash, start_flash, trace_on }

export { run_board_theme_host_flash }
