import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_wopr_data } from './run-board-theme-wopr-data'
import { run_board_theme_wopr_phase } from './run-board-theme-wopr-phase'
import type { Wopr } from './run-board-theme-wopr-place'

// The WARGAMES theme's alarm (joshuafolkken/kit#9137): the film's red rotating beacon, drawn as a bar of
// lamps along the header's first row with its lit lobe turning, and the pink light the beacon throws
// across the room, a band crossing the whole screen once a turn for its first turns.

const { restyle, set_cell } = run_board_theme_host_grid
const { PEAK_TICKS } = run_board_theme_host_state
const { BEACON, BEACON_PINK } = run_board_theme_wopr_data
const { CLOSE_FROM, WAR_START, notice_age } = run_board_theme_wopr_phase

// The alarm sounds from the wars' start to the ending's dark, in ticks since the notice began. The
// beacon turns once every `turn` ticks and its drone sounds the first `on` of them (the film's on and
// off could not be told apart: invented); the pink light crosses on the first `crossings` turns (the
// film's two to three).
const ALARM = {
	from: PEAK_TICKS - 1 + WAR_START,
	ticks: CLOSE_FROM - WAR_START,
	turn: 20,
	on: 12,
	crossings: 3,
}
// The lobe's shades reach this many cells from its centre, the brightest first; past them a lamp is out.
const LOBE = { core: 1, glow: 3, edge: 6 }
const REACHES: ReadonlyArray<number> = [LOBE.core, LOBE.glow, LOBE.edge]
// The pink band is this many columns wide.
const BAND = 6
const BEACON_ROW = 0
const WASHED = '48;2;'

// How far through its turn the beacon is, 0 to 1; the alarm's start begins a turn.
function turn_share(alarm_age: number): number {
	const into = ((alarm_age % ALARM.turn) + ALARM.turn) % ALARM.turn

	return into / ALARM.turn
}

// A lamp's shade `distance` cells from the lobe's centre: past every reach, the last one — out.
function lobe_ink(distance: number): string {
	const shade = REACHES.findIndex((reach) => distance <= reach)

	return BEACON.at(shade) ?? ''
}

// The beacon along the header's first row, over the machine's gauges: a lamp a cell, the lit lobe
// running left to right once a turn and coming round again.
function beacon_bar(wopr: Wopr, grid: Grid, state: ThemeState, tick: number): void {
	const { x, w } = wopr.api.layout.head_top
	const centre = turn_share(notice_age(state, tick) - ALARM.from) * w

	for (let at = 0; at < w; at++) {
		const apart = Math.abs(at - centre)
		const ink = lobe_ink(Math.min(apart, w - apart))

		set_cell(grid, { y: BEACON_ROW, x: x + at }, ['▄', ink])
	}
}

// The pink light crossing the screen with the beacon's first turns: what is drawn under the band turns
// pink, a cell with a ground of its own left alone.
function beacon_light(wopr: Wopr, grid: Grid, state: ThemeState, tick: number): void {
	const alarm_age = notice_age(state, tick) - ALARM.from

	if (alarm_age < 0 || alarm_age >= ALARM.crossings * ALARM.turn) return
	const head = Math.floor(turn_share(alarm_age) * (wopr.api.layout.w + BAND))

	restyle(
		grid,
		([ch, style], x) => ch !== ' ' && x > head - BAND && x <= head && !style.includes(WASHED),
		() => BEACON_PINK,
	)
}

const run_board_theme_wopr_alarm = { ALARM, beacon_bar, beacon_light, turn_share }

export { run_board_theme_wopr_alarm }
