import { run_board_fire_trail } from './run-board-fire-trail'
import { run_board_jump } from './run-board-jump'
import { run_board_rgb, type Rgb } from './run-board-rgb'

// joshuafolkken/kit#8677: the bttf jump and arrival painted over the whole board, cell by cell. Through
// the run up the merging lane's row whitens, blue-white flares cross the board and, in its last ticks,
// arcs crackle over the header, the animation area and that row; the jump washes the board in five
// tints and then white, and the board thaws from ice to its own colors, the top rows first, each cell at
// its own moment. The arrival is black, three flashes, then the same thaw. The capacitor and the gauge
// (`is_figure`) keep their own light until the thaw.

const { mixed, parsed, scaled } = run_board_rgb
const { END_TICKS, THAW_AT, THAW_TICKS, WASH_TICKS, ARRIVE_TICKS, flash_of } = run_board_jump
const { trail_cells } = run_board_fire_trail

const WHITE = parsed('255;255;255')
const ICE = parsed('190;235;255')
const ARC = parsed('150;210;255')
const FLASH_BACK = parsed('200;230;255')
const FLARE = parsed('130;190;255')
const FLARE_CORE = parsed('240;248;255')
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
// A flare every `FLARE_EVERY` ticks, `FLARE_TICKS` long, once `FLARE_FROM` of the run up is typed: its
// slant from `FLARE_START`, `FLARE_STEP` columns a tick and `FLARE_SLANT` a row, its core and its edge.
const FLARE_EVERY = 14
const FLARE_TICKS = 3
const FLARE_FROM = 0.4
const FLARE_START = 10
const FLARE_STEP = 45
const FLARE_SLANT = 3
const FLARE_CORE_WIDTH = 3
const FLARE_EDGE = 9
const FLARE_GROUND = 0.5
const FLARE_MIX = 0.8
// The arcs: the last `ARC_TICKS` of the run up; at full a share of cells turns to a mark, more tinted.
const ARC_TICKS = 15
const ARC_MARK = 0.05
const ARC_TINT = 0.3
const ARC_MIX = 0.8
const SPARKS = 14
const ARC_MARKS = '╱ ╲ │ ─ ┼'.split(' ')
const SPARK_MARKS = '· *'.split(' ')
const HEADER_ROWS = 3
// The merging lane's row whitens to this at most.
const LANE_WHITE = 0.7
// A stable noise in 0..1 for a cell, so a thaw does not flicker.
const NOISE_X = 12.9898
const NOISE_Y = 78.233
const NOISE_SCALE = 43_758.5453
// Each tick moves the arcs' noise this far.
const TICK_SHIFT = 31.7
const HALF = 2

// A cell on screen, 0-based: its letter, its colors, and whether it is the capacitor's or the gauge's.
interface PaintCell {
	x: number
	y: number
	text: string
	fg: Rgb
	bg?: Rgb | undefined
	is_figure: boolean
}

// The board a jump is painted on: its rows, the merging lane's row and the animation area's rows, none
// where the area is not out — then the jump is the wash and the thaw only — and the fire trails' rows.
interface JumpScene {
	rows: number
	lane?: number | undefined
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

// The cell `phase` ticks into a flare crossing the board on a slant.
function flared(cell: PaintCell, phase: number, rows: number): PaintCell {
	const center = FLARE_START + phase * FLARE_STEP + (rows / HALF - cell.y) * FLARE_SLANT
	const off = Math.abs(cell.x - center)

	if (off < FLARE_CORE_WIDTH) return { ...cell, fg: FLARE_CORE, bg: scaled(FLARE, FLARE_GROUND) }
	if (off < FLARE_EDGE) return { ...cell, fg: mixed(cell.fg, FLARE, FLARE_MIX) }

	return cell
}

function is_arc_row(y: number, scene: JumpScene): boolean {
	const { panel } = scene
	const is_panel = panel !== undefined && y >= panel.top && y < panel.top + panel.rows

	return y < HEADER_ROWS || is_panel || y === scene.lane
}

// The cell under arcs at `share` of their crackle, `t` ticks from the jump.
function arced(cell: PaintCell, share: number, t: number): PaintCell {
	const roll = noise(cell.x + t * TICK_SHIFT, cell.y)

	if (roll >= share * ARC_TINT) return cell
	if (roll >= share * ARC_MARK) return { ...cell, fg: mixed(cell.fg, ARC, ARC_MIX) }
	const mark = ARC_MARKS[Math.floor(noise(cell.y, cell.x + t) * ARC_MARKS.length)] ?? '─'

	return { ...cell, text: mark, fg: ARC }
}

// The blank cells a spark lands on `t` ticks from the jump at `share` of the crackle, by `x;y`.
function sparks_of(share: number, t: number, scene: JumpScene, columns: number): Set<string> {
	return new Set(
		Array.from({ length: Math.ceil(share * SPARKS) }, (_, count) => {
			const x = Math.floor(noise(count, t) * columns)
			const y = Math.floor(noise(t, count) * scene.rows)

			return `${String(x)};${String(y)}`
		}),
	)
}

function sparked(cell: PaintCell, sparks: ReadonlySet<string>, t: number): PaintCell {
	if (cell.text !== ' ' || !sparks.has(`${String(cell.x)};${String(cell.y)}`)) return cell
	const mark = SPARK_MARKS[Math.floor(noise(cell.x, t) * SPARK_MARKS.length)] ?? '·'

	return { ...cell, text: mark, fg: ARC }
}

// The merging lane's row whitened `share` of the way through the run up.
function lane_lit(cell: PaintCell, share: number, scene: JumpScene): PaintCell {
	if (cell.y !== scene.lane) return cell

	return { ...cell, fg: mixed(cell.fg, WHITE, share * LANE_WHITE) }
}

// The cell under a flare, when one crosses `share` of the way through the run up, `typed` ticks in.
function flare_over(cell: PaintCell, share: number, typed: number, rows: number): PaintCell {
	const phase = typed % FLARE_EVERY

	return share > FLARE_FROM && phase < FLARE_TICKS ? flared(cell, phase, rows) : cell
}

// The run up's light on a cell `t` ticks from a jump over `letters`, the figure left to its own.
function ramped(cell: PaintCell, t: number, letters: number, scene: JumpScene): PaintCell {
	const typed = t + letters
	const share = typed / letters
	const arcs = (t + ARC_TICKS) / ARC_TICKS
	const flaring = flare_over(lane_lit(cell, share, scene), share, typed, scene.rows)

	return arcs > 0 && is_arc_row(cell.y, scene) ? arced(flaring, arcs, t) : flaring
}

// The run up painted where the area is out: the figure left to its own, sparks in the last ticks.
// Where the area is not out the run up leaves the board as it is.
function run_up(
	cells: ReadonlyArray<PaintCell>,
	t: number,
	letters: number,
	scene: JumpScene,
): Array<PaintCell> {
	if (scene.panel === undefined) return [...cells]
	const columns = Math.max(1, ...cells.map((cell) => cell.x + 1))
	const sparks =
		t >= -ARC_TICKS ? sparks_of((t + ARC_TICKS) / ARC_TICKS, t, scene, columns) : new Set<string>()

	return cells.map((cell) =>
		cell.is_figure ? cell : sparked(ramped(cell, t, letters, scene), sparks, t),
	)
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

// The board `t` ticks from the jump: the fire trails burning over the thaw, the wash over both.
function after_jump(
	cells: ReadonlyArray<PaintCell>,
	t: number,
	scene: JumpScene,
): Array<PaintCell> {
	const burning = trail_cells(thawing(cells, t), t, scene.trails ?? [], noise)

	if (t >= WASH_TICKS) return burning
	const { color, share } = wash_of(t)

	return burning.map((cell) => washed(cell, color, share))
}

// The board `t` ticks from a jump over `letters`: the run up where the area is out, then the wash, the
// thaw and the trails; as it is outside the jump.
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

const run_board_jump_paint = { HEADER_ROWS, ICE, TINTS, arrive_cells, jump_cells, noise }

export { run_board_jump_paint }
export type { JumpScene, PaintCell }
