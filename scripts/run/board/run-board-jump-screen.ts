import { run_board_drop_screen, type DropScreen, type ScreenCell } from './run-board-drop-screen'
import type { TerminalSize } from './run-board-fit'
import { run_board_jump, type JumpRun } from './run-board-jump'
import { run_board_jump_paint, type JumpScene, type PaintCell } from './run-board-jump-paint'
import type { GlyphBytes } from './run-board-layer'
import type { Beat } from './run-board-reveal-blocks'
import { run_board_rgb, type Rgb } from './run-board-rgb'
import { run_board_screen } from './run-board-screen'
import type { Typing } from './run-board-type-rows'

// joshuafolkken/kit#8677: the bttf jump written over the board between redraws, cell by cell, past the
// theme: each cell as the theme drew it (`DropScreen`) recolored by `run_board_jump_paint`. The merge
// jump runs at a frame a tick over every cell of the terminal, giving the frame layer the cells it
// paints (joshuafolkken/kit#8826) and none once it is over; the arrival writes the
// cells that changed since its last beat (joshuafolkken/kit#8788). The animation area is the panel's
// own (it thaws its cells itself), and the cells the spinners and the typing rows write are left to them.

const { ARRIVE_TICKS, TICK_MS, is_running, tick_of } = run_board_jump
const { jump_cells } = run_board_jump_paint
const { palette, parsed } = run_board_rgb
const { synced } = run_board_screen

const CSI = '\u{1B}['
const RESET = `${CSI}0m`
const CLEAR = `${CSI}H${CSI}J`
// joshuafolkken/kit#8739: a frame every tick, as the demo draws it.
const FRAME_MS = TICK_MS
const DEFAULT_FG = parsed('204;204;204')
const BACKGROUND = /48;2;(\d+);(\d+);(\d+)/u
// joshuafolkken/kit#8744: each foreground a style sets, in order — 24-bit, named (`styleText`'s `33m`,
// `90m`: its kind and color) or back to the default (`39m`); a cell's is the last.
const FOREGROUNDS = /38;2;(?<rgb>\d+;\d+;\d+)|\[(?<kind>[39])(?<color>[0-7])m|\[39m/gu
const BRIGHT_KIND = '9'
// No typing rows: the arrival is drawn before the board types any (a value import of
// `run_board_type_rows.NO_TYPING` would cycle through `run-board-intro.ts`).
const NO_TYPING: Typing = { seen: undefined, lines: [] }

// A jump being drawn: its timeline, the board's cells as the theme drew them, the rows it is painted
// over and the cells the animation area's painter draws, `row;column` 1-based, which it leaves alone.
interface JumpDraw {
	run: JumpRun
	screen: DropScreen
	scene: JumpScene
	owned?: ReadonlySet<string> | undefined
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

// Whether the jump paints a cell, 1-based: none the typing rows or the area's painter own
// (joshuafolkken/kit#8782: the area's cells its painter leaves, and the spinners' places, kept the
// dark through the wash; the spinners hold while the jump runs, `is_lit`).
function is_painted(draw: JumpDraw, row: number, column: number): boolean {
	if (draw.owned?.has(key_of(row, column)) === true) return false

	return !run_board_drop_screen.is_held(draw.screen, { row, column })
}

function frame_of(ms: number): number {
	return ms - (ms % FRAME_MS)
}

// Whether a jump is being drawn at `ms`, at the frame it is drawn on.
function is_lit(draw: JumpDraw | undefined, ms: number): boolean {
	return draw !== undefined && is_running(draw.run, frame_of(ms))
}

function last_foreground(style: string): Partial<Record<string, string>> {
	return [...style.matchAll(FOREGROUNDS)].at(-1)?.groups ?? {}
}

// The foreground a style leaves a cell in: a named one as the palette draws it.
function foreground_of(style: string): Rgb {
	const { rgb, kind, color } = last_foreground(style)

	if (rgb !== undefined) return parsed(rgb)
	if (color === undefined) return DEFAULT_FG

	return palette(Number(color), kind === BRIGHT_KIND) ?? DEFAULT_FG
}

// A cell as the jump paints it, its colors the theme's.
function paint_cell(cell: ScreenCell, x: number, y: number): PaintCell {
	const fg = foreground_of(cell.style)

	return { x, y, text: cell.text, fg, bg: rgb_in(cell.style, BACKGROUND), is_figure: false }
}

// The board's cells the jump paints, 0-based.
function painted_cells(draw: JumpDraw): Array<PaintCell> {
	return draw.screen.rows.flatMap((row, y) =>
		row
			.map((cell, x) => ({ cell, x }))
			.filter(({ x }) => is_painted(draw, y + 1, x + 1))
			.map(({ cell, x }) => paint_cell(cell, x, y)),
	)
}

// joshuafolkken/kit#8826: a draw's cells never change while it runs, so every frame of it shares the
// cells its first frame found.
const cells_of_draw = new WeakMap<JumpDraw, ReadonlyArray<PaintCell>>()

function cells_of(draw: JumpDraw): ReadonlyArray<PaintCell> {
	const known = cells_of_draw.get(draw)

	if (known !== undefined) return known
	const cells = painted_cells(draw)

	cells_of_draw.set(draw, cells)

	return cells
}

function rgb_text(rgb: Rgb): string {
	return rgb.join(';')
}

// A cell's style: the theme's with the jump's colors over it.
function cell_style(cell: PaintCell, style: string): string {
	const bg = cell.bg === undefined ? '' : `${CSI}48;2;${rgb_text(cell.bg)}m`

	return `${RESET}${style}${CSI}38;2;${rgb_text(cell.fg)}m${bg}`
}

// A cell's bytes with no cursor: its style, the letter.
function cell_bytes(cell: PaintCell, style: string): string {
	return `${cell_style(cell, style)}${cell.text}${RESET}`
}

// A cell's bytes: the cursor there, then the cell.
function painted_bytes(cell: PaintCell, style: string): string {
	return `${CSI}${key_of(cell.y + 1, cell.x + 1)}H${cell_bytes(cell, style)}`
}

// joshuafolkken/kit#8826: compared channel by channel — every jump frame compares every cell, and
// joining the channels into strings cost the frame tens of milliseconds.
function is_same_rgb(first: Rgb | undefined, second: Rgb | undefined): boolean {
	if (first === undefined || second === undefined) return first === second

	return first.every((channel, index) => channel === second[index])
}

function is_same(painted: PaintCell, plain: PaintCell): boolean {
	const is_bg_same = is_same_rgb(painted.bg, plain.bg)

	return painted.text === plain.text && is_same_rgb(painted.fg, plain.fg) && is_bg_same
}

// Each cell's style and letter by `row;column`.
function keyed(cells: ReadonlyArray<PaintCell>, screen: DropScreen): Map<string, GlyphBytes> {
	return new Map(
		cells.map((cell) => [
			key_of(cell.y + 1, cell.x + 1),
			{ style: cell_style(cell, style_at(screen, cell)), text: cell.text },
		]),
	)
}

// joshuafolkken/kit#8826: the frame a draw painted last, which every layer drawn again at it shares.
const last_painted = new WeakMap<JumpDraw, { ms: number; painted: Map<string, GlyphBytes> }>()

function changed_at(draw: JumpDraw, ms: number): Map<string, GlyphBytes> {
	const plain = cells_of(draw)
	const painted = jump_cells(plain, tick_of(draw.run, ms), draw.run.letters, draw.scene)
	const changed = painted.filter((cell, index) => {
		const base = plain[index]

		return base !== undefined && !is_same(cell, base)
	})

	return keyed(changed, draw.screen)
}

// The cells the jump changes at `ms` from the board as drawn, by `row;column`.
function painted_at(draw: JumpDraw, ms: number): Map<string, GlyphBytes> {
	if (!is_running(draw.run, ms)) return new Map()
	const last = last_painted.get(draw)

	if (last?.ms === ms) return last.painted
	const painted = changed_at(draw, ms)

	last_painted.set(draw, { ms, painted })

	return painted
}

// Every cell of the screen but half a wide character, 0-based.
function screen_cells(screen: DropScreen): Array<PaintCell> {
	return screen.rows.flatMap((row, y) =>
		row.flatMap((cell, x) => (cell.is_wide ? [] : [paint_cell(cell, x, y)])),
	)
}

// A cell at `key` as the theme drew it.
function theme_bytes(key: string, style: string, text: string): string {
	return `${CSI}${key}H${RESET}${style}${text}${RESET}`
}

// joshuafolkken/kit#8744: a cell the arrival has thawed whole is written as the theme drew it, so the
// frame after the beats brings no color the palette's guess at a named one missed.
function arrival_bytes(cell: PaintCell, plain: PaintCell | undefined, screen: DropScreen): string {
	const style = style_at(screen, cell)

	if (plain === undefined || !is_same(cell, plain)) return painted_bytes(cell, style)

	return theme_bytes(key_of(cell.y + 1, cell.x + 1), style, cell.text)
}

// The bytes in `now` that `before` does not already hold, by `row;column`.
function changed_bytes(now: Map<string, string>, before: Map<string, string>): Array<string> {
	return [...now].filter(([key, bytes]) => before.get(key) !== bytes).map(([, bytes]) => bytes)
}

// Every cell of the arrival `tick` ticks in, by `row;column`. Called through the paint module so a
// test sees each beat built only when it is taken (joshuafolkken/kit#8788).
function arrive_keyed(
	plain: ReadonlyArray<PaintCell>,
	screen: DropScreen,
	tick: number,
): Map<string, string> {
	const cells = run_board_jump_paint.arrive_cells(plain, tick)

	return new Map(
		cells.map((cell, index) => [
			key_of(cell.y + 1, cell.x + 1),
			arrival_bytes(cell, plain[index], screen),
		]),
	)
}

// joshuafolkken/kit#8732: the first frame comes held, the screen wiped ahead of it
// (`run-board-screen.ts`); cut into cells, the wipe would ride in the first row's style and clear the
// screen with every one of them written.
function without_wipe(drawn: string): string {
	return drawn.startsWith(CLEAR) ? drawn.slice(CLEAR.length) : drawn
}

// joshuafolkken/kit#8677: the bttf board's arrival over its first frame as the theme draws it, a beat
// every tick: the screen cleared, the frame black, three flashes, then the thaw. The frame itself is
// written whole once the beats end. joshuafolkken/kit#8788: each beat is built when it is taken and
// writes only the cells that changed since the beat before — the first, every cell after the clear.
// The screen is wiped nowhere past the first beat (#8732's `without_wipe`), so no cell needs rewriting.
function* arrive_beats(drawn: string, size: TerminalSize | undefined): Generator<Beat, void> {
	const frame = { lines: without_wipe(drawn).split('\n'), spots: [] }
	const screen = run_board_drop_screen.screen_of(frame, NO_TYPING, size)
	const plain = screen_cells(screen)
	let before = new Map<string, string>()

	for (let tick = 0; tick < ARRIVE_TICKS; tick += 1) {
		const now = arrive_keyed(plain, screen, tick)
		const clear = tick === 0 ? CLEAR : ''

		yield { text: synced(`${clear}${changed_bytes(now, before).join('')}`), ms: TICK_MS }
		before = now
	}
}

const NO_WASH: ReadonlyMap<string, GlyphBytes> = new Map()

// joshuafolkken/kit#8826: the cells the jump paints at `ms`, a frame every `FRAME_MS`, each its style
// and letter by `row;column`; none once it is over. A cell it no longer paints shows the board
// beneath it again (`run_board_layer.glyph_layer`), so nothing is put back.
function wash_at(draw: JumpDraw | undefined, ms: number): ReadonlyMap<string, GlyphBytes> {
	return draw === undefined ? NO_WASH : painted_at(draw, frame_of(ms))
}

const run_board_jump_screen = { FRAME_MS, arrive_beats, is_lit, wash_at }

export { run_board_jump_screen }
export type { JumpDraw }
