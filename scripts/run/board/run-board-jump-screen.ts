import { run_board_drop_screen, type DropScreen, type ScreenCell } from './run-board-drop-screen'
import type { TerminalSize } from './run-board-fit'
import { run_board_jump, type JumpRun } from './run-board-jump'
import { run_board_jump_paint, type JumpScene, type PaintCell } from './run-board-jump-paint'
import type { PanelArea } from './run-board-panel-draw'
import type { Beat } from './run-board-reveal-blocks'
import { run_board_rgb, type Rgb } from './run-board-rgb'
import { run_board_screen } from './run-board-screen'
import type { Typing } from './run-board-type-rows'

// joshuafolkken/kit#8677: the bttf jump written over the board between redraws, cell by cell, past the
// theme: each cell as the theme drew it (`DropScreen`) recolored by `run_board_jump_paint`, at ten frames
// a second, writing only the cells that changed since the last turn and putting each back as it was once
// the jump is over. The animation area is the panel's own (it thaws its cells itself), and the cells the
// spinners and the typing rows write are left to them.

const { ARRIVE_TICKS, TICK_MS, is_running, tick_of } = run_board_jump
const { arrive_cells, jump_cells } = run_board_jump_paint
const { parsed } = run_board_rgb
const { synced } = run_board_screen

const CSI = '\u{1B}['
const RESET = `${CSI}0m`
const CLEAR = `${CSI}H${CSI}J`
const FRAME_MS = 100
const DEFAULT_FG = parsed('204;204;204')
const FOREGROUND = /38;2;(\d+);(\d+);(\d+)/u
const BACKGROUND = /48;2;(\d+);(\d+);(\d+)/u
// No typing rows: the arrival is drawn before the board types any (a value import of
// `run_board_type_rows.NO_TYPING` would cycle through `run-board-intro.ts`).
const NO_TYPING: Typing = { seen: undefined, lines: [] }

// A jump being drawn: its timeline, the board's cells as the theme drew them, the rows it is painted
// over and the animation area, whose cells it leaves alone.
interface JumpDraw {
	run: JumpRun
	screen: DropScreen
	scene: JumpScene
	panel?: PanelArea | undefined
}

function key_of(row: number, column: number): string {
	return `${String(row)};${String(column)}`
}

function style_at(screen: DropScreen, cell: PaintCell): string {
	return screen.rows[cell.y]?.[cell.x]?.style ?? ''
}

function rgb_in(style: string, pattern: RegExp): Rgb | undefined {
	const match = pattern.exec(style)

	return match === null ? undefined : parsed(match.slice(1).join(';'))
}

// Whether a cell, 1-based, is the animation area's: its rows from a column before its first lamp place.
function is_panel(panel: PanelArea | undefined, row: number, column: number): boolean {
	if (panel === undefined || row < panel.top || row >= panel.top + panel.rows) return false

	return column >= Math.min(...panel.lamps.map((lamp) => lamp.column)) - 1
}

// Whether the jump paints a cell, 1-based: none the spinners, the typing rows or the area own.
function is_painted(draw: JumpDraw, row: number, column: number): boolean {
	if (run_board_drop_screen.is_kept(draw.screen, { row, column })) return false

	return !is_panel(draw.panel, row, column)
}

function paint_cell(cell: ScreenCell, x: number, y: number): PaintCell {
	const fg = rgb_in(cell.style, FOREGROUND) ?? DEFAULT_FG

	return { x, y, text: cell.text, fg, bg: rgb_in(cell.style, BACKGROUND), is_figure: false }
}

// The board's cells the jump paints, 0-based.
function cells_of(draw: JumpDraw): Array<PaintCell> {
	return draw.screen.rows.flatMap((row, y) =>
		row
			.map((cell, x) => ({ cell, x }))
			.filter(({ x }) => is_painted(draw, y + 1, x + 1))
			.map(({ cell, x }) => paint_cell(cell, x, y)),
	)
}

function rgb_text(rgb: Rgb): string {
	return rgb.join(';')
}

// A cell's bytes: the cursor there, the theme's style with the jump's colors over it, the letter.
function painted_bytes(cell: PaintCell, style: string): string {
	const bg = cell.bg === undefined ? '' : `${CSI}48;2;${rgb_text(cell.bg)}m`
	const at = `${CSI}${key_of(cell.y + 1, cell.x + 1)}H`

	return `${at}${RESET}${style}${CSI}38;2;${rgb_text(cell.fg)}m${bg}${cell.text}${RESET}`
}

function is_same(painted: PaintCell, plain: PaintCell): boolean {
	const is_bg_same = painted.bg?.join(',') === plain.bg?.join(',')

	return painted.text === plain.text && painted.fg.join(',') === plain.fg.join(',') && is_bg_same
}

// Each cell's bytes by `row;column`.
function keyed(cells: ReadonlyArray<PaintCell>, screen: DropScreen): Map<string, string> {
	return new Map(
		cells.map((cell) => [
			key_of(cell.y + 1, cell.x + 1),
			painted_bytes(cell, style_at(screen, cell)),
		]),
	)
}

// The cells the jump changes at `ms` from the board as drawn, by `row;column`.
function painted_at(draw: JumpDraw, ms: number | undefined): Map<string, string> {
	if (ms === undefined || !is_running(draw.run, ms)) return new Map()
	const plain = cells_of(draw)
	const painted = jump_cells(plain, tick_of(draw.run, ms), draw.run.letters, draw.scene)
	const changed = painted.filter((cell, index) => {
		const base = plain[index]

		return base !== undefined && !is_same(cell, base)
	})

	return keyed(changed, draw.screen)
}

// Every cell of the screen but half a wide character, 0-based.
function screen_cells(screen: DropScreen): Array<PaintCell> {
	return screen.rows.flatMap((row, y) =>
		row.flatMap((cell, x) => (cell.is_wide ? [] : [paint_cell(cell, x, y)])),
	)
}

// The arrival's cells `tick` ticks in that changed since `since`, every one with no `since`.
function arrive_bytes(screen: DropScreen, tick: number, since: number | undefined): string {
	const plain = screen_cells(screen)
	const now = keyed(arrive_cells(plain, tick), screen)
	const before = since === undefined ? new Map() : keyed(arrive_cells(plain, since), screen)

	return [...now]
		.filter(([key, bytes]) => before.get(key) !== bytes)
		.map(([, bytes]) => bytes)
		.join('')
}

// joshuafolkken/kit#8677: the bttf board's arrival over its first frame as the theme draws it, a beat
// every `FRAME_MS`: the screen cleared, the frame black, three flashes, then the thaw. The frame itself
// is written whole once the beats end.
function arrive_beats(drawn: string, size: TerminalSize | undefined): Array<Beat> {
	const frame = { lines: drawn.split('\n'), spots: [] }
	const screen = run_board_drop_screen.screen_of(frame, NO_TYPING, size)
	const step = FRAME_MS / TICK_MS
	const ticks = Array.from({ length: Math.ceil(ARRIVE_TICKS / step) }, (_, index) => index * step)

	return ticks.map((tick, index) => {
		const since = index === 0 ? undefined : tick - step
		const clear = index === 0 ? CLEAR : ''

		return { text: synced(`${clear}${arrive_bytes(screen, tick, since)}`), ms: FRAME_MS }
	})
}

function frame_of(ms: number): number {
	return ms - (ms % FRAME_MS)
}

// A cell put back as the theme drew it.
function restore_bytes(screen: DropScreen, key: string): string {
	const [row = 0, column = 0] = key.split(';').map(Number)
	const cell = screen.rows[row - 1]?.[column - 1]

	return cell === undefined ? '' : `${CSI}${key}H${RESET}${cell.style}${cell.text}${RESET}`
}

// The bytes the jump writes `at_ms`, a frame every `FRAME_MS`: each cell it paints differently since
// `since_ms`, and each it painted then and no longer does put back as the theme drew it.
function jump_bytes(
	draw: JumpDraw | undefined,
	at_ms: number,
	since_ms: number | undefined,
): string {
	if (draw === undefined) return ''
	if (since_ms !== undefined && frame_of(since_ms) === frame_of(at_ms)) return ''
	const now = painted_at(draw, frame_of(at_ms))
	const before = painted_at(draw, since_ms === undefined ? undefined : frame_of(since_ms))
	const changed = [...now].filter(([key, bytes]) => before.get(key) !== bytes)
	const gone = [...before.keys()].filter((key) => !now.has(key))

	return [
		...changed.map(([, bytes]) => bytes),
		...gone.map((key) => restore_bytes(draw.screen, key)),
	].join('')
}

const run_board_jump_screen = { FRAME_MS, arrive_beats, jump_bytes }

export { run_board_jump_screen }
export type { JumpDraw }
