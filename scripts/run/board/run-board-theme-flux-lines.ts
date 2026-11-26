import { run_board_theme_flux_bolts } from './run-board-theme-flux-bolts'
import type { FluxContext, Line } from './run-board-theme-flux-context'
import { run_board_theme_flux_data } from './run-board-theme-flux-data'
import { run_board_theme_flux_jump } from './run-board-theme-flux-jump'
import { run_board_theme_flux_paint } from './run-board-theme-flux-paint'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Channel, Grid, ThemeState } from './run-board-theme-host-types'

// The BTTF theme's typed lines (joshuafolkken/kit#8917): a line arrives cold — its strip flashes,
// sparks crackle ahead of the cursor, the letters thaw from ice white. ROW does it on the new lane
// with bolts over the area; PROGRESS on its line, then glows once and lets a few embers die. Ported
// from the confirmed theme demo's `fixed-v21-theme-bttf.mjs`.

const { BOLT_TURNS, draw_swarm, place_in } = run_board_theme_flux_bolts
const { EMBER, FLUX, ICE, WHITE } = run_board_theme_flux_data
const { stepped } = run_board_theme_flux_jump
const { HEAD_BACK, is_blank, mix, paint, recolor, scaled } = run_board_theme_flux_paint
const { BOLD, cell_at, pick, set_cell } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { active } = run_board_theme_host_state

const FLASH_ONE = 0.35
const FLASH_TWO = 0.65
const ROW_FLASHES = [
	{ start: 0, ticks: 2, level: FLASH_ONE },
	{ start: 3, ticks: 2, level: FLASH_TWO },
	{ start: 6, ticks: 3, level: 1 },
]
const FLASH_GROUND = 0.45
const ROW_WHITE = 2
const ROW_THAW = 20
const ROW_SPREAD = 6
const ROW_SPARKS = 3
const ROW_SPARK_REACH = 14
const SPARK_LEAD = 2
const THROW_EVERY = 2
const THROW_SALT = 61
const CURSOR = '█'
const AREA_BOLTS = 5
const AREA_SEED = 13_000

// PROGRESS's quiet finish, half a second: the typed letters glow once in the capacitor's warm light
// and fade back in quarter steps, and a few embers in the fire's pale yellow die out after the text.
const SETTLE_TICKS = 10
const SETTLE_GLOW = 0.6
const EMBERS = 4
const EMBER_REACH = 8
const EMBER_LIFE = 4
const LIFE_SALT = 51
const PLACE_SALT = 52
const HALF = 2

// The flashes' level `age` ticks into a line, or undefined between them. A line with `repeat` plays
// its opening burst again, whole, every `repeat` ticks while it types.
function flash_level(line: Line, age: number): number | undefined {
	const at = line.repeat ? age % line.repeat : age

	return ROW_FLASHES.find(({ start, ticks }) => at >= start && at < start + ticks)?.level
}

// The line's strip flashes ice white three times as it starts (the arrival's flashes, line-sized).
function line_flash(grid: Grid, line: Line, age: number): void {
	const level = flash_level(line, age)

	if (level === undefined) return
	const ground = scaled(ICE, level * FLASH_GROUND)

	for (let x = line.flash_from; x < line.end; x++) {
		recolor(grid, { y: line.y, x }, (look) => ({ f: mix(look.f, WHITE, level), b: ground }))
	}
}

// How far a letter `letter_age` ticks old has thawed: 0 while it holds white.
function letter_share(line: Line, letter_age: number, x: number): number {
	const white = line.white ?? ROW_WHITE

	if (letter_age < white) return 0

	return stepped((letter_age - white - (x % ROW_SPREAD)) / (line.thaw ?? ROW_THAW))
}

function thaw_letter(grid: Grid, line: Line, age: number, x: number): void {
	if (is_blank(cell_at(grid, line.y, x))) return
	const letter_age = age - (x - line.x)
	const is_white = letter_age < (line.white ?? ROW_WHITE)
	const share = letter_share(line, letter_age, x)

	if (share >= 1) return
	recolor(grid, { y: line.y, x }, (look) => ({
		f: is_white ? WHITE : mix(ICE, look.f, share),
		b: look.b,
	}))
}

// Typed letters arrive white, then thaw from ice white to their own color (the typing demo's thaw).
function line_thaw(grid: Grid, line: Line, age: number, shown: number): void {
	for (let { x } = line; x < shown; x++) thaw_letter(grid, line, age, x)
	if (shown < line.end) set_cell(grid, { y: line.y, x: shown }, [CURSOR, paint(WHITE) + BOLD])
}

// Small bolts crackle on the line's blank cells ahead of the cursor.
function line_sparks(grid: Grid, line: Line, shown: number, tick: number): void {
	const reach = line.reach ?? ROW_SPARK_REACH
	const sparks = line.sparks ?? ROW_SPARKS

	// The sparks start from the cell after the cursor's next, on the line's own row (its die 3 lands
	// in a box one row high).
	draw_swarm(grid, {
		now: tick,
		count: () => sparks,
		seed: (born) => born + line.salt,
		place: place_in({ left: shown + SPARK_LEAD, top: line.y, w: reach, h: 1 }),
		can_draw: (x, y) => y === line.y && x > shown && x < line.end,
	})
}

// Sparks thrown off the cursor: a one-cell bolt glyph right beside it every other tick, white on
// the arc ground (a bolt's head).
function cursor_sparks(grid: Grid, line: Line, shown: number, tick: number): void {
	const x = shown + 1

	if (!line.throws || tick % THROW_EVERY === 1 || x >= line.end) return
	const turn = pick(BOLT_TURNS, hash(tick, 0, THROW_SALT))

	set_cell(grid, { y: line.y, x }, [turn.ch, paint(WHITE, HEAD_BACK)])
}

function arrive_line(grid: Grid, line: Line, channel: Channel, tick: number): void {
	const age = tick - channel.start
	const shown = line.x + channel.length

	line_flash(grid, line, age)
	line_thaw(grid, line, age, shown)
	line_sparks(grid, line, shown, tick)
	cursor_sparks(grid, line, shown, tick)
}

function settle_letters(context: FluxContext, grid: Grid, end: number, share: number): void {
	const { progress } = context.layout

	for (let { x } = progress; x < end; x++) {
		if (is_blank(cell_at(grid, progress.y, x))) continue
		recolor(grid, { y: progress.y, x }, (look) => ({ f: mix(look.f, FLUX, share), b: look.b }))
	}
}

function ember(context: FluxContext, grid: Grid, channel: Channel, index: number): void {
	const { progress } = context.layout
	const cooled = Math.max(0, channel.cooled)
	const end = progress.x + channel.total
	const life =
		EMBER_LIFE + Math.floor(hash(channel.start, index, LIFE_SALT) * (SETTLE_TICKS - EMBER_LIFE))
	const x = end + 1 + Math.floor(hash(channel.start, index, PLACE_SALT) * EMBER_REACH)

	if (cooled >= life || x >= progress.end) return
	const glyph = cooled < life / HALF ? '●' : '∙'

	set_cell(grid, { y: progress.y, x }, [glyph, paint(scaled(EMBER, 1 - cooled / life))])
}

function settle_line(context: FluxContext, grid: Grid, channel: Channel): void {
	const cooled = Math.max(0, channel.cooled)
	const share = stepped(1 - cooled / SETTLE_TICKS) * SETTLE_GLOW

	settle_letters(context, grid, context.layout.progress.x + channel.total, share)
	for (let index = 0; index < EMBERS; index++) ember(context, grid, channel, index)
}

// PROGRESS: v14's ROW on the progress line, then the quiet finish.
function draw_progress(context: FluxContext, grid: Grid, state: ThemeState, tick: number): void {
	const { progress } = state

	if (!active(progress, SETTLE_TICKS)) return
	if (progress.is_typing) arrive_line(grid, context.lines.progress, progress, tick)
	else settle_line(context, grid, progress)
}

// While the lane types, bolts crawl over the whole event area as well.
function area_bolts(context: FluxContext, grid: Grid, tick: number): void {
	const { area_end, area_top, edge } = context.layout

	draw_swarm(grid, {
		now: tick,
		count: () => AREA_BOLTS,
		seed: (born) => born + AREA_SEED,
		place: place_in({ left: 0, top: area_top, w: edge, h: area_end - area_top + 1 }),
		can_draw: (x, y) => y >= area_top && y <= area_end && x < edge,
	})
}

// ROW: the lane arrives cold, its row flashing again every second, with bolts over the area. The
// jump is attempted and does not happen: once the row is typed through the speed only falls back.
function draw_row(context: FluxContext, grid: Grid, state: ThemeState, tick: number): void {
	const { row } = state

	if (!row.is_typing) return
	arrive_line(grid, context.lines.row, row, tick)
	area_bolts(context, grid, tick)
}

const run_board_theme_flux_lines = {
	arrive_line,
	draw_progress,
	draw_row,
	flash_level,
	letter_share,
}

export { run_board_theme_flux_lines }
