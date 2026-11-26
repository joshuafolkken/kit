import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Channel, Grid, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_magi_data, type MagiKit } from './run-board-theme-magi-data'
import { run_board_theme_magi_draw } from './run-board-theme-magi-draw'
import { run_board_theme_magi_panels } from './run-board-theme-magi-panels'

// The MAGI theme's gauges (joshuafolkken/kit#8917), ported from the confirmed theme demo: the level
// on the rule (deliberating, the result, the condition), the active limit's clock and the sync rate.

const { BOLD, cells_bar, fg, put, put_level } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { active, NOTICE_END } = run_board_theme_host_state
const { AMBER, BLINK, ORANGE, ORANGE_ON, RED_BOLD, RED_ON } = run_board_theme_magi_data
const { EFFECT_TICKS, SIDE_W, VOTE_END, WHITE } = run_board_theme_magi_data
const { clock_text, is_lit } = run_board_theme_magi_draw
const { verdict_of } = run_board_theme_magi_panels

// The result's panels and the votes that pass it.
const LEVEL = { panels: 3, passing: 2 }
// The clock: seconds a tick, its spare at the end of the scene, and when it turns to danger.
const SECOND = 0.05
const LIMIT_SPARE = 1.2
const DANGER = 2.5
// Idle on external power: the feed's ticks a cell, its cells and their column.
const FEED = { pace: 5, cycle: 5, cells: 4, x: 10 }
// The sync rate: full, its bar's cells, the noise's seed and size while it types, and the idle scan.
const RATE = { full: 100, bar: 10, seed: 90, noise: 3, scan: 18, turn: 9, pace: 2 }
const CONDITION_GREEN = '90;200;120'

function is_counting(progress: Channel): boolean {
	return progress.index >= 0 && progress.cooled < EFFECT_TICKS
}

function is_settled(progress: Channel): boolean {
	return progress.index < 0 || progress.cooled >= VOTE_END
}

function deliberating_level(kit: MagiKit, grid: Grid, tick: number): void {
	const style = is_lit(tick, BLINK.slow) ? ORANGE_ON : `${ORANGE}${BOLD}`

	put_level(grid, kit.api.layout.level_spot, ' MAGI DELIBERATING', style)
}

// This theme's own level, where the wargames frame had its DEFCON scale.
function condition_level(kit: MagiKit, grid: Grid, state: ThemeState, tick: number): void {
	const is_red = active(state.notice, NOTICE_END)
	const text = is_red ? ' CONDITION RED' : ' CONDITION GREEN'
	const red_style = is_lit(tick, BLINK.slow) ? RED_ON : RED_BOLD

	put_level(grid, kit.api.layout.level_spot, text, is_red ? red_style : fg(CONDITION_GREEN))
}

function result_level(kit: MagiKit, grid: Grid, progress: Channel): void {
	let yes = 0

	for (let panel = 0; panel < LEVEL.panels; panel++) yes += verdict_of(progress.index, panel)
	const text = ` RESULT ${String(yes)}/3 ${yes >= LEVEL.passing ? 'PASSED' : 'DENIED'}`

	put_level(grid, kit.api.layout.level_spot, text, `${fg('255;200;80')}${BOLD}`)
}

function consensus(kit: MagiKit, grid: Grid, state: ThemeState, tick: number): void {
	const { progress } = state

	if (progress.is_typing) {
		deliberating_level(kit, grid, tick)

		return
	}

	if (is_counting(progress)) return

	if (is_settled(progress)) {
		condition_level(kit, grid, state, tick)

		return
	}

	result_level(kit, grid, progress)
}

function clock_style(is_danger: boolean, tick: number): string {
	if (is_danger && is_lit(tick, BLINK.fast)) return RED_ON

	return `${fg(is_danger ? '255;60;40' : '255;170;40')}${BOLD}`
}

// INTERNAL while anything types, else EXTERNAL with the feed showing as four cells filling over and over.
function power_row(kit: MagiKit, grid: Grid, state: ThemeState, tick: number): void {
	const { px } = kit.api.layout
	const is_flash = state.busy && is_lit(tick, BLINK.fast)

	put(
		grid,
		{ y: kit.rows.power, x: px },
		state.busy ? ' INTERNAL ' : ' EXTERNAL ',
		is_flash ? RED_ON : ORANGE_ON,
	)
	if (state.busy) return
	const fed = Math.floor(tick / FEED.pace) % FEED.cycle

	put(grid, { y: kit.rows.power, x: px + FEED.x }, cells_bar(fed, FEED.cells), fg('230;120;0'))
}

// The clock runs on internal power while anything types; it is set to end the scene near a second.
function activity_limit(kit: MagiKit, grid: Grid, state: ThemeState, tick: number): void {
	const { px } = kit.api.layout
	const { total } = state.event
	const left = Math.max(0, total * SECOND + LIMIT_SPARE - state.busy_ticks * SECOND)
	const is_danger = total > 0 && left < DANGER
	const clock = total > 0 ? clock_text(left) : '--:--:--'

	put(grid, { y: kit.rows.limit, x: px }, 'ACTIVE LIMIT'.padEnd(SIDE_W), ORANGE)
	put(grid, { y: kit.rows.clock, x: px }, clock.padEnd(SIDE_W), clock_style(is_danger, tick))
	power_row(kit, grid, state, tick)
}

function sync_rate(state: ThemeState, tick: number): number | undefined {
	const { row } = state

	if (row.index < 0 || row.total === 0) return undefined
	const jitter = row.is_typing ? hash(tick, 0, RATE.seed) * RATE.noise : 0

	return Math.min(RATE.full, (row.length / row.total) * RATE.full + jitter)
}

function rate_style(rate: number | undefined, state: ThemeState, tick: number): string {
	const is_white = rate !== undefined && !state.row.is_typing && is_lit(tick, BLINK.slow)

	return `${fg(is_white ? WHITE : AMBER)}${BOLD}`
}

// The panel's status block: the sync rate, small.
function status(kit: MagiKit, grid: Grid, state: ThemeState, tick: number): void {
	const x = kit.api.layout.edge - SIDE_W
	const rate = sync_rate(state, tick)
	const text = rate === undefined ? '--.-%' : `${rate.toFixed(1)}%`
	const bar_x = x + SIDE_W - RATE.bar

	put(grid, { y: kit.rows.limit, x }, 'SYNC RATE'.padStart(SIDE_W), ORANGE)
	put(grid, { y: kit.rows.clock, x }, text.padStart(SIDE_W), rate_style(rate, state, tick))
	put(
		grid,
		{ y: kit.rows.power, x: bar_x },
		cells_bar(Math.round((rate ?? 0) / RATE.bar), RATE.bar),
		ORANGE,
	)
	// Idle, with no lane syncing: one lit cell runs back and forth along the empty bar.
	if (rate !== undefined) return
	const at = Math.abs((Math.floor(tick / RATE.pace) % RATE.scan) - RATE.turn)

	put(grid, { y: kit.rows.power, x: bar_x + at }, '▮', fg(AMBER))
}

const run_board_theme_magi_gauges = { SECOND, activity_limit, consensus, status, sync_rate }

export { run_board_theme_magi_gauges }
