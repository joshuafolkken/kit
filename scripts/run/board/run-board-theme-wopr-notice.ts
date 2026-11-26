import { run_board_theme_host_flash } from './run-board-theme-host-flash'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Grid, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_wopr_data } from './run-board-theme-wopr-data'
import { run_board_theme_wopr_led } from './run-board-theme-wopr-led'
import { run_board_theme_wopr_map } from './run-board-theme-wopr-map'
import { run_board_theme_wopr_panel } from './run-board-theme-wopr-panel'
import { run_board_theme_wopr_phase } from './run-board-theme-wopr-phase'
import type { Wopr } from './run-board-theme-wopr-place'
import { run_board_theme_wopr_row } from './run-board-theme-wopr-row'
import { run_board_theme_wopr_wars } from './run-board-theme-wopr-wars'

// The WARGAMES theme's NOTICE (joshuafolkken/kit#8917), ported from the confirmed theme demo. The
// timeline (s = ticks since the notice began; c = ticks since the peak at s 79):
// - build, s 0-49: the LAUNCH panel locks a position every 5 ticks in WOPR's order; then the matched
//   code blinks until the peak. DEFCON 5 → 1 over the build; from s 40 the header carries the match
//   and the countdown.
// - c 0-3: the spark burns the whole screen white, white, yellow, orange.
// - c 4-146: the area splits: sixteen wars on the left, the WINNER table paging on the right.
// - c 147-237: dark; the film's last three lines type two letters a tick and hold; DEFCON 5.

const { trace_on } = run_board_theme_host_flash
const { ESC, block, put, restyle } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { PEAK_TICKS } = run_board_theme_host_state
const { CLOSING, INK, LEVEL_INKS, SPARK } = run_board_theme_wopr_data
const { matched, notice_look } = run_board_theme_wopr_led
const { arrived_at, split } = run_board_theme_wopr_map
const { game_at, panel } = run_board_theme_wopr_panel
const {
	CLOSE_FROM,
	CLOSE_PACE: TYPE_PACE,
	WAR_START,
	count,
	is_notice,
	level_of,
	notice_age,
	seconds,
} = run_board_theme_wopr_phase
const { flicker } = run_board_theme_wopr_row
const { impacts, in_air, war_at, white_ticks } = run_board_theme_wopr_wars

const PAIR = 2
// The glare's odds grow from none to one in two over the wars.
const GLARE = { most: 0.5, salt: 3, seed: 77 }
// The header's name blinks four ticks in eight during the build.
const NAME_BLINK = { every: 8, lit: 4 }
// Ten strays flicker at level 2 and below.
const RED_STRAYS = 10
const RED_LEVEL = 2
const SCENARIO_WIDTH = 3
// The first game is played a move a tick, the next two two moves a tick, the rest three.
const GAME_PACES = { first: 1, quick: 0.5, quick_games: 3, rest_moves: 3 }
const ALL_MATCHED = 10
const WASHED = '48;2;'
const LAUNCH_CODE = 'WOPR · LAUNCH CODE'

// The header's three lines: WOPR's name and work, its state, its clock.
type HeaderLines = [string, string, string]

function is_drawn([ch]: Cell): boolean {
	return ch !== ' '
}

function closing_line(
	wopr: Wopr,
	grid: Grid,
	line: { index: number; text: string },
	left: number,
): void {
	const { x, y } = wopr.closing
	const cursor = left < line.text.length ? '█' : ''

	put(grid, { y: y + PAIR * line.index, x }, `${line.text.slice(0, left)}${cursor}`, INK.close)
}

// The ending, as the film's last screen: the area dark, and three left-aligned lines typing two
// letters a tick behind a block, then holding to the ending's end.
function closing(wopr: Wopr, grid: Grid, state: ThemeState): void {
	const { area_top, area_end } = wopr.api.layout
	let left = (state.notice.cooled - CLOSE_FROM + 1) * TYPE_PACE

	for (let y = area_top; y <= area_end; y++) wopr.api.blank_row(grid, y)

	for (const [index, text] of CLOSING.entries()) {
		if (left <= 0) return
		closing_line(wopr, grid, { index, text }, left)
		left -= text.length
	}
}

// Everything else on the screen dimmed while the ending types (the notice's bar left lit).
function darken(grid: Grid, state: ThemeState): void {
	if (state.notice.is_typing || state.notice.cooled < CLOSE_FROM) return
	restyle(
		grid,
		([ch, style]) => ch !== ' ' && style !== INK.close && !style.includes(WASHED),
		() => INK.dark,
	)
}

// The whole-screen frames: the spark, then each war's last ticks, white.
function whole_style(wopr: Wopr, cooled: number): string | undefined {
	if (cooled < SPARK.length) return SPARK[cooled]
	const now = war_at(wopr.wars, cooled)

	return now && cooled - now.start >= now.length - white_ticks(now) ? INK.white_out : undefined
}

// Between the whole-screen frames, the glare: a tick of every drawn character washed pale.
function flash(wopr: Wopr, grid: Grid, state: ThemeState): void {
	const { cooled, is_typing: is_building } = state.notice

	if (is_building || cooled >= CLOSE_FROM) return
	const style = whole_style(wopr, cooled)

	if (style) {
		restyle(
			grid,
			() => true,
			() => style,
		)

		return
	}

	const odds = (GLARE.most * (cooled - WAR_START)) / (CLOSE_FROM - WAR_START)

	const is_glaring = hash(cooled, GLARE.salt, GLARE.seed) < odds

	if (is_glaring) restyle(grid, is_drawn, () => INK.wash)
}

// The build's lines: the match and the countdown.
function build_lines(state: ThemeState, tick: number): HeaderLines {
	const look = notice_look(state, tick)
	const countdown = seconds(PEAK_TICKS - 1 - notice_age(state, tick))

	return [LAUNCH_CODE, `MATCH ${count(matched(look))}/10`, `LAUNCH T-${countdown}`]
}

// WOPR's work in the header: the match and the countdown, then the war, then the table.
function header_lines(wopr: Wopr, state: ThemeState, tick: number): HeaderLines {
	const { cooled, is_typing: is_building } = state.notice

	if (is_building) return build_lines(state, tick)

	if (cooled < WAR_START) {
		return [LAUNCH_CODE, 'MATCH 10/10 · CPE 1704 TKS', `LAUNCH T+${seconds(cooled)}`]
	}

	const now = war_at(wopr.wars, cooled)
	const scenario = String((now ? wopr.wars.indexOf(now) : -1) + 1).padStart(SCENARIO_WIDTH, '0')
	const strategies = count(arrived_at(wopr, cooled))

	return [
		'WOPR · WAR SIMULATION',
		`SCENARIO ${scenario} · STRATEGIES ${strategies}`,
		'WINNER: NONE',
	]
}

// The missiles in the pins' column.
function missiles(wopr: Wopr, grid: Grid, state: ThemeState): void {
	const { cooled, is_typing: is_building } = state.notice
	const { x } = wopr.api.layout.head_right
	const is_war = !is_building && cooled >= WAR_START
	const flying = is_war ? in_air(wopr.wars, cooled) : 0
	const landed = is_war ? impacts(wopr.wars, cooled) : 0

	block(grid, wopr.api.layout.head_right, INK.red_on)
	put(grid, { y: 0, x }, 'MISSILES', INK.white_on)
	put(grid, { y: 1, x }, `IN AIR  ${count(flying)}`, INK.yellow_on)
	put(grid, { y: PAIR, x }, `IMPACT  ${count(landed)}`, INK.red_on)
}

// The header overflow, from the build's second half to the third bar.
function is_overflowing(state: ThemeState, tick: number): boolean {
	return notice_age(state, tick) >= PEAK_TICKS / PAIR && state.notice.cooled < CLOSE_FROM
}

// WOPR's name blinks through the build, then pulses with the trace's bars.
function is_name_lit(state: ThemeState, tick: number): boolean {
	if (state.notice.is_typing) return tick % NAME_BLINK.every < NAME_BLINK.lit

	return trace_on(state)
}

function header_overflow(wopr: Wopr, grid: Grid, state: ThemeState, tick: number): void {
	if (!is_overflowing(state, tick)) return
	const is_lit = is_name_lit(state, tick)
	const [name, status, clock] = header_lines(wopr, state, tick)

	block(grid, wopr.api.layout.head_left, INK.red_on)
	put(grid, { y: 0, x: 1 }, name, is_lit ? INK.white_on : INK.orange_on)
	put(grid, { y: 1, x: 1 }, status, INK.yellow_on)
	put(grid, { y: PAIR, x: 1 }, clock, INK.red_on)
	missiles(wopr, grid, state)
}

// The board below the area reddens as the level drops — a color a level, held between steps — and at
// level 2 and below stray characters flicker as code.
function redden(wopr: Wopr, grid: Grid, state: ThemeState, tick: number): void {
	const level = level_of(state)
	const ink = LEVEL_INKS[level - 1]
	const { area_end } = wopr.api.layout

	if (!ink) return
	restyle(
		grid,
		([ch, style], _, y) =>
			y > area_end && ch !== ' ' && !style.startsWith(ESC) && !style.startsWith('rule'),
		() => ink,
	)

	if (level <= RED_LEVEL) {
		flicker(wopr, grid, tick, { strays: RED_STRAYS, from_y: area_end + 1, ink: INK.white_on })
	}
}

function notice_pace(game: number): number {
	if (game === 0) return GAME_PACES.first

	return game < GAME_PACES.quick_games ? GAME_PACES.quick : 1 / GAME_PACES.rest_moves
}

// The build: the LAUNCH panel and the game beside it, ever faster.
function notice_panel(wopr: Wopr, grid: Grid, state: ThemeState, tick: number): void {
	const look = notice_look(state, tick)
	const done = matched(look)
	const is_done = done === ALL_MATCHED
	const status = is_done ? 'CODE ACCEPTED · LAUNCH' : `SEARCHING · ${count(done)}/10`
	const play = game_at(notice_age(state, tick), notice_pace)

	panel(wopr, grid, { status, status_ink: is_done ? INK.red_on : INK.orange_on, look, play })
}

function notice_area(wopr: Wopr, grid: Grid, state: ThemeState, tick: number): void {
	const { cooled, is_typing: is_building } = state.notice

	if (is_building || cooled < WAR_START) notice_panel(wopr, grid, state, tick)
	else if (cooled < CLOSE_FROM) split(wopr, grid, state, tick)
	else closing(wopr, grid, state)
}

function notice_event(wopr: Wopr, grid: Grid, state: ThemeState, tick: number): boolean {
	if (!is_notice(state)) return false
	notice_area(wopr, grid, state, tick)
	header_overflow(wopr, grid, state, tick)
	redden(wopr, grid, state, tick)

	return true
}

const run_board_theme_wopr_notice = {
	closing,
	darken,
	flash,
	header_lines,
	notice_event,
	notice_pace,
	whole_style,
}

export { run_board_theme_wopr_notice }
