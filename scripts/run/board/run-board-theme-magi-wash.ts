import { run_board_theme_host_flash } from './run-board-theme-host-flash'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid, Point, ThemeLayout, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_magi_data, type Pace } from './run-board-theme-magi-data'

// The MAGI theme's whole-screen light (joshuafolkken/kit#8917), ported from the confirmed theme
// demo: the red wash of a NOTICE with its lamp band, the board's text turning pale on it, and the
// idle pulse — the lights along the rules and the heartbeat down the board.

const { BOLD, ESC, fg, is_rule, restyle } = run_board_theme_host_grid
const { active, NOTICE_END, TRACE_END } = run_board_theme_host_state
const { trace_on } = run_board_theme_host_flash
const { EFFECT_TICKS, PACES } = run_board_theme_magi_data

// The red as the notice builds (from its floor, by its rise), as the trace ends (from its fall),
// and while the bar is off.
const RED_LEVEL = { floor: 0.15, rise: 0.6, fall: 0.7, off: 0.3, pale: 0.7 }
// As the notice builds, the wash reaches this far beyond the screen's height from the notice's row.
const REACH = 1.5
const WASH = { r: 165, g: 10, b: 8 }
// The lamp as flat color with a band: the wash is one even red (its level in eight steps), and a
// brighter band — a core and a shoulder either side — crosses it at the smooth lamp's spacing and
// speed. Between bands every cell of a row holds the same color from frame to frame, so a frame
// writes only the band's moving edges where the smooth lamp rewrote every washed cell.
const LAMP_EVERY = 90
const LAMP_SPEED = 6
const LAMP_PART = 10
const LAMP = { steps: 8, base: 0.72, core: 0.28, shoulder: 0.14, core_from: 1, shoulder_to: 3 }
// The rule's light repeats every this many cells, each row this many out of step with the last.
const RULE = { every: 60, row_step: 7 }
const HEARTBEAT_ROWS = 2

// How red the whole screen is, 0 to 1, during a NOTICE. It rises as the notice builds, to full at
// the peak. After the peak it is the alarm lamp: full while the notice's bar is lit, low while the
// bar is off. When the third bar goes out the red drains away over the effect's last second.
function red_level(state: ThemeState): number {
	const { notice } = state

	if (!active(notice, NOTICE_END)) return 0
	if (notice.is_typing) return RED_LEVEL.floor + RED_LEVEL.rise * (notice.length / notice.total)

	if (notice.cooled >= TRACE_END) {
		return RED_LEVEL.fall * (1 - (notice.cooled - TRACE_END) / (NOTICE_END - TRACE_END))
	}

	return trace_on(state) ? 1 : RED_LEVEL.off
}

// The band's lift at `at` cells into its spacing: the core, then a shoulder either side.
function lamp_lift(at: number): number {
	if (at >= LAMP_PART * LAMP.core_from && at < LAMP_PART * (LAMP.core_from + 1)) return LAMP.core

	return at < LAMP_PART * LAMP.shoulder_to ? LAMP.shoulder : 0
}

function banded_lamp(level: number, x: number, tick: number): number {
	const even = Math.ceil(level * LAMP.steps) / LAMP.steps
	const at = (((x - tick * LAMP_SPEED) % LAMP_EVERY) + LAMP_EVERY) % LAMP_EVERY

	return even * (LAMP.base + lamp_lift(at))
}

// How far from the notice's row the wash reaches.
function wash_reach(layout: ThemeLayout, state: ThemeState): number {
	const { notice } = state

	return notice.is_typing ? (notice.length / notice.total) * layout.h * REACH : layout.h
}

// The red wash behind every cell: it spreads out from the notice's row as the notice builds, and a
// brighter band turns across it like a lamp.
function red_wash(
	layout: ThemeLayout,
	at: Point,
	tick: number,
	state: ThemeState,
): string | undefined {
	const level = red_level(state)

	if (level === 0 || Math.abs(at.y - layout.notice.y) > wash_reach(layout, state)) return undefined

	const lamp = banded_lamp(level, at.x, tick)

	return `${String(Math.round(WASH.r * lamp))};${String(Math.round(WASH.g * lamp))};${String(Math.round(WASH.b * lamp))}`
}

// With the screen fully red, the board's own text turns pale so it still reads.
function red_text(grid: Grid, state: ThemeState): void {
	if (red_level(state) < RED_LEVEL.pale) return
	restyle(
		grid,
		([, style]) => !style.startsWith(ESC),
		() => fg('255;225;205'),
	)
}

// The busier the board, the harder the system works: the lights run faster, stretch longer and
// burn brighter from IDLE to PROGRESS to ROW, and the heartbeat comes round more often.
function pace_of(state: ThemeState): Pace {
	if (active(state.row, EFFECT_TICKS)) return PACES.row
	if (active(state.progress, EFFECT_TICKS)) return PACES.progress

	return PACES.idle
}

function rule_at(x: number, y: number, moved: number): number {
	return (((x - moved + y * RULE.row_step) % RULE.every) + RULE.every) % RULE.every
}

// A light runs along every section rule, each rule a little out of step with the last.
function rule_lights(grid: Grid, pace: Pace, moved: number): void {
	restyle(
		grid,
		(cell, x, y) => is_rule(cell) && rule_at(x, y, moved) < pace.length,
		(x, y) => `${fg(rule_at(x, y, moved) === pace.length - 1 ? pace.head : pace.color)}${BOLD}`,
	)
}

// A pulse passes down the board two rows at a time — the system's heartbeat.
function heartbeat(grid: Grid, layout: ThemeLayout, pace: Pace, tick: number): void {
	const beat = (tick % pace.beat) * HEARTBEAT_ROWS

	if (beat >= layout.h) return
	restyle(
		grid,
		([ch, style], _, y) => ch !== ' ' && (y === beat || y === beat + 1) && !style.startsWith(ESC),
		() => fg('255;205;120'),
	)
}

// Idle, across the whole screen: the rules' lights and the heartbeat. It keeps running through a
// PROGRESS and a ROW, whose effects stay in the area and the panel (they draw over it there). A
// NOTICE turns the whole screen red and fills the gaps with bands, so there it stops until the
// NOTICE is over.
function idle_pulse(grid: Grid, layout: ThemeLayout, state: ThemeState, tick: number): void {
	if (active(state.notice, NOTICE_END)) return
	const pace = pace_of(state)

	rule_lights(grid, pace, Math.floor(tick * pace.speed))
	heartbeat(grid, layout, pace, tick)
}

const run_board_theme_magi_wash = {
	banded_lamp,
	idle_pulse,
	lamp_lift,
	pace_of,
	red_level,
	red_text,
	red_wash,
}

export { run_board_theme_magi_wash }
