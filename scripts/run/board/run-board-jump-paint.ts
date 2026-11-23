import { run_board_clock_roll } from './run-board-clock-roll'
import { run_board_fire_trail } from './run-board-fire-trail'
import { run_board_jump } from './run-board-jump'
import { run_board_jump_bolts, type BoltCell } from './run-board-jump-bolts'
import { run_board_rgb, type Rgb } from './run-board-rgb'

// joshuafolkken/kit#8677: the bttf jump and arrival painted over the whole board, cell by cell. In the
// run up's last ticks arcs crackle over the header and the animation area (joshuafolkken/kit#8739:
// with or without the area out), and small bolts cross every cell from its first letter
// (joshuafolkken/kit#8740); the jump washes the board in five tints and then white, and the board thaws
// from ice to its own colors, the top rows first, each cell at its own moment. The arrival is black,
// three flashes, then the same thaw. The capacitor and the gauge (`is_figure`) keep their own light
// until the thaw, crossed only by the run up's bolts.

const { mixed, parsed, scaled } = run_board_rgb
const { END_TICKS, THAW_AT, THAW_TICKS, WASH_TICKS, ARRIVE_TICKS, flash_of } = run_board_jump
const { trail_cells } = run_board_fire_trail
const { rolled_clocks } = run_board_clock_roll
const { bolt_cells } = run_board_jump_bolts

const WHITE = parsed('255;255;255')
const ICE = parsed('190;235;255')
const ARC = parsed('150;210;255')
const FLASH_BACK = parsed('200;230;255')
// Through the jump the board is washed in these, two ticks each, then white until `WASH_TICKS`.
const TINTS = ['159;216;238', '120;200;255', '150;140;235', '190;225;255', '60;160;240'].map(
	(tint) => parsed(tint),
)
const TINT_TICKS = 2
const TINT_SHARE = 0.6
const WHITE_SHARE = 0.9
// A wash past this share turns the letters white rather than to its color.
const WHITE_PAST = 0.8
const WASH_GROUND = 0.4
// A cell thaws over `THAW_SPAN` ticks, late by up to `THAW_SPREAD` by its noise and `ROW_LAG` a row.
const THAW_SPREAD = 18
const ROW_LAG = 0.4
const THAW_SPAN = 14
// The arcs: the last `ARC_TICKS` of the run up; at full a share of cells turns to a mark, more tinted.
const ARC_TICKS = 15
const ARC_MARK = 0.05
const ARC_TINT = 0.3
const ARC_MIX = 0.8
const ARC_MARKS = '╱ ╲ │ ─ ┼'.split(' ')
const HEADER_ROWS = 3
// A stable noise in 0..1 for a cell, so a thaw does not flicker.
const NOISE_X = 12.9898
const NOISE_Y = 78.233
const NOISE_SCALE = 43_758.5453
// Each tick moves the arcs' noise this far.
const TICK_SHIFT = 31.7

// A cell on screen, 0-based: its letter, its colors, and whether it is the capacitor's or the gauge's.
interface PaintCell {
	x: number
	y: number
	text: string
	fg: Rgb
	bg?: Rgb | undefined
	is_figure: boolean
}

// The board a jump is painted on: its rows and the animation area's rows, none where the area is not
// out — then the jump is the wash and the thaw only — and the fire trails' rows.
interface JumpScene {
	rows: number
	panel?: { top: number; rows: number } | undefined
	trails?: ReadonlyArray<number> | undefined
}

function noise(x: number, y: number): number {
	const value = Math.sin(x * NOISE_X + y * NOISE_Y) * NOISE_SCALE

	return value - Math.floor(value)
}

function clamped(share: number): number {
	return Math.min(1, Math.max(0, share))
}

// The cell `since` ticks into a thaw: from ice to its own color, the top rows first.
function thawed(cell: PaintCell, since: number): PaintCell {
	const share = (since - noise(cell.x, cell.y) * THAW_SPREAD - cell.y * ROW_LAG) / THAW_SPAN

	return { ...cell, fg: mixed(ICE, cell.fg, clamped(share)) }
}

// The cell's letters `share` of the way to `color`, on a dark ground of it; the figure keeps its own.
function washed(cell: PaintCell, color: Rgb, share: number): PaintCell {
	if (cell.is_figure) return cell
	const fg = mixed(cell.fg, share > WHITE_PAST ? WHITE : color, share)

	return { ...cell, fg, bg: cell.bg ?? scaled(color, WASH_GROUND) }
}

function is_arc_row(y: number, scene: JumpScene): boolean {
	const { panel } = scene
	const is_panel = panel !== undefined && y >= panel.top && y < panel.top + panel.rows

	return y < HEADER_ROWS || is_panel
}

// The cell under arcs at `share` of their crackle, `t` ticks from the jump.
function arced(cell: PaintCell, share: number, t: number): PaintCell {
	const roll = noise(cell.x + t * TICK_SHIFT, cell.y)

	if (roll >= share * ARC_TINT) return cell
	if (roll >= share * ARC_MARK) return { ...cell, fg: mixed(cell.fg, ARC, ARC_MIX) }
	const mark = ARC_MARKS[Math.floor(noise(cell.y, cell.x + t) * ARC_MARKS.length)] ?? '─'

	return { ...cell, text: mark, fg: ARC }
}

// The cell under a bolt, if one crosses it: the bolt's letter and colors, the cell's ground kept where
// the bolt gives none.
function bolted(cell: PaintCell, bolts: ReadonlyMap<string, BoltCell>): PaintCell {
	const bolt = bolts.get(`${String(cell.x)};${String(cell.y)}`)

	return bolt === undefined ? cell : { ...cell, ...bolt, bg: bolt.bg ?? cell.bg }
}

// The run up's arcs on a cell `t` ticks from the jump.
function ramped(cell: PaintCell, t: number, scene: JumpScene): PaintCell {
	const arcs = (t + ARC_TICKS) / ARC_TICKS

	return arcs > 0 && is_arc_row(cell.y, scene) ? arced(cell, arcs, t) : cell
}

// The run up over `letters` ticks: the figure left to its own, arcs in the last ticks, the area out or
// not, and bolts over every cell — the figure's too — from the first letter (joshuafolkken/kit#8740).
function run_up(
	cells: ReadonlyArray<PaintCell>,
	t: number,
	letters: number,
	scene: JumpScene,
): Array<PaintCell> {
	const columns = Math.max(1, ...cells.map((cell) => cell.x + 1))
	const bolts = bolt_cells(t, { columns, rows: scene.rows, letters }, noise)

	return cells.map((cell) => bolted(cell.is_figure ? cell : ramped(cell, t, scene), bolts))
}

// The wash's color and share `t` ticks from the jump: the tints, then white.
function wash_of(t: number): { color: Rgb; share: number } {
	const tint = TINTS[Math.floor(t / TINT_TICKS)]

	return tint === undefined
		? { color: FLASH_BACK, share: WHITE_SHARE }
		: { color: tint, share: TINT_SHARE }
}

// The board `t` ticks from the jump under its thaw, as it is before the wash ends and after the thaw.
function thawing(cells: ReadonlyArray<PaintCell>, t: number): Array<PaintCell> {
	const since = t - WASH_TICKS

	return since >= 0 && since < THAW_TICKS ? cells.map((cell) => thawed(cell, since)) : [...cells]
}

// The board `t` ticks into the wash, as it is past it.
function washing(cells: ReadonlyArray<PaintCell>, t: number): Array<PaintCell> {
	if (t >= WASH_TICKS) return [...cells]
	const { color, share } = wash_of(t)

	return cells.map((cell) => washed(cell, color, share))
}

// The board `t` ticks from the jump: the fire trails burning over the thaw, the wash over both, the
// header's clocks rolling over all.
function after_jump(
	cells: ReadonlyArray<PaintCell>,
	t: number,
	scene: JumpScene,
): Array<PaintCell> {
	const burning = trail_cells(thawing(cells, t), t, scene.trails ?? [], noise)

	return rolled_clocks(washing(burning, t), t, noise)
}

// The board `t` ticks from a jump over `letters`: the run up, then the wash, the thaw and the trails;
// as it is outside the jump.
function jump_cells(
	cells: ReadonlyArray<PaintCell>,
	t: number,
	letters: number,
	scene: JumpScene,
): Array<PaintCell> {
	if (t < -letters || t >= END_TICKS) return [...cells]

	return t < 0 ? run_up(cells, t, letters, scene) : after_jump(cells, t, scene)
}

// The board `tick` ticks into the arrival: black, lit by the flashes, then thawing.
function arrive_cells(cells: ReadonlyArray<PaintCell>, tick: number): Array<PaintCell> {
	if (tick >= ARRIVE_TICKS) return [...cells]
	if (tick >= THAW_AT) return cells.map((cell) => thawed(cell, tick - THAW_AT))
	const fg = scaled(WHITE, flash_of(tick))

	return cells.map((cell) => ({ ...cell, fg }))
}

const run_board_jump_paint = { ICE, TINTS, arrive_cells, jump_cells, noise }

export { run_board_jump_paint }
export type { JumpScene, PaintCell }
