import { run_board_fit } from './run-board-fit'
import { run_board_jump, type JumpRun } from './run-board-jump'
import { run_board_jump_figure } from './run-board-jump-figure'
import { run_board_labels, type Paint } from './run-board-labels'
import type { Lamp } from './run-board-lamp-spots'
import { run_board_screen } from './run-board-screen'
import type { BoardPorts } from './run-board-state'

// joshuafolkken/kit#8676: the animation area a theme draws its own cells in — the throughput rule's row and
// the seven under it (the `24h` and `7d` rows, the blank line, the usage rule and its first three rows —
// through GitHub's, joshuafolkken/kit#8712), up to
// the rule's end. The theme hands a painter (`ThemeDefinition.panel`); this module places the area, wakes
// the turn every `PANEL_TICK_MS` where the painter ticks and writes only the cells that changed, past the
// theme (`write_drawn`).
// The area shows only where the frame lays out the lamp panel — a colored terminal, room for its lamps and
// the throughput rows on screen — so it is found from the frame's lamps.

const CSI = '\u{1B}['
const PANEL_TICK_MS = 50
// The throughput rule's row and the seven under it.
const AREA_ROWS = 8
const FOREGROUND_RGB = `${CSI}38;2;`
const BACKGROUND_RGB = `${CSI}48;2;`
const DEFAULT_FOREGROUND = `${CSI}39m`
const DEFAULT_BACKGROUND = `${CSI}49m`

// The moment a painter draws at, and whether a row is typing then; the bttf time jump running then and
// the moment the board's arrival began, where one is (joshuafolkken/kit#8677).
interface PanelMoment {
	ms: number
	is_burst: boolean
	jump?: JumpRun | undefined
	arrive_ms?: number | undefined
}

// One cell on screen, 1-based, drawn as `text` in `fg` on `bg`; a background is a shade, or a named
// background color (`bgYellow`).
interface PanelCell {
	row: number
	column: number
	text: string
	fg?: Paint | undefined
	bg?: Paint | undefined
}

// The area on screen: the throughput rule's row (`top`), the column the rule ends at (`end`), its rows,
// and the frame's lamp places in it.
interface PanelArea {
	top: number
	end: number
	rows: number
	lamps: ReadonlyArray<Lamp>
}

// A theme's painter: the cells it draws at a moment, whether it runs from the first frame rather than
// once the rows are typed, and whether the turn wakes every `PANEL_TICK_MS` for it — one that does not
// is drawn on the turns the spinner and the rows wake, as the lamps and the rain always were.
interface PanelPainter {
	is_idle: boolean
	is_ticking: boolean
	cells: (area: PanelArea, at: PanelMoment) => ReadonlyArray<PanelCell>
}

// The painter and the area a turn draws, none where the area is not out.
interface PanelDraw {
	painter: PanelPainter
	area: PanelArea
}

type PanelPorts = Pick<BoardPorts, 'write' | 'write_drawn'>

// The area's rows from the rule's line: `AREA_ROWS`, fewer where the frame ends first or the usage
// section does — at the second blank line under the rule, as before the GitHub row is read.
function rows_from(lines: ReadonlyArray<string>, rule_index: number): number {
	const under = lines.slice(rule_index, rule_index + AREA_ROWS)
	const blanks = [...under.keys()].filter((at) => run_board_fit.width_of(under[at] ?? '') === 0)

	return blanks[1] ?? under.length
}

// The frame's area found from its lamps on screen: the rule's row above the first lamp's, ended where that
// rule ends; none with no lamp on screen.
function area_of(
	lines: ReadonlyArray<string>,
	starts: ReadonlyArray<number>,
	lamps: ReadonlyArray<Lamp>,
): PanelArea | undefined {
	const [first] = lamps

	if (first === undefined) return undefined
	const rule_index = starts.indexOf(first.row) - 1
	const rule = lines[rule_index] ?? ''

	return {
		top: first.row - 1,
		end: run_board_fit.width_of(rule),
		rows: rows_from(lines, rule_index),
		lamps,
	}
}

// `text` on `bg`: a style name (`bgYellow`) as it is; a shade as a 24-bit background where the terminal
// draws one, else no background — a shade's palette fallback is a foreground, which would repaint the
// text rather than back it.
function backed(bg: Paint | undefined, text: string): string {
	if (bg === undefined) return text
	const painted = run_board_labels.painted(bg, text)

	if (typeof bg === 'string') return painted
	if (!painted.startsWith(FOREGROUND_RGB)) return text

	return `${BACKGROUND_RGB}${painted.slice(FOREGROUND_RGB.length, -DEFAULT_FOREGROUND.length)}${DEFAULT_BACKGROUND}`
}

function cell_bytes(cell: PanelCell): string {
	const text = backed(cell.bg, run_board_labels.painted(cell.fg, cell.text))

	return `${CSI}${String(cell.row)};${String(cell.column)}H${text}`
}

function keyed(cells: ReadonlyArray<PanelCell>): Map<string, string> {
	return new Map(
		cells.map((cell) => [`${String(cell.row)};${String(cell.column)}`, cell_bytes(cell)]),
	)
}

// The painter's cells at a moment, thawed or flashed where a jump or the arrival lights the board.
function looked(draw: PanelDraw, at: PanelMoment): ReadonlyArray<PanelCell> {
	return run_board_jump_figure.figure_look(draw.painter.cells(draw.area, at), at)
}

// joshuafolkken/kit#8782: while a jump runs, the rows typing over the area write the frame's lamp
// marks into it, so the area is written whole each tick rather than only where it changed.
function before_of(
	draw: PanelDraw,
	at: PanelMoment,
	since: PanelMoment | undefined,
): ReadonlyArray<PanelCell> {
	if (since === undefined) return []
	if (at.jump !== undefined && run_board_jump.is_running(at.jump, at.ms)) return []

	return looked(draw, since)
}

// The cells that changed since `since` drawn as they are `at`, every one with no `since` or through a
// jump.
function panel_bytes(draw: PanelDraw, at: PanelMoment, since: PanelMoment | undefined): string {
	const now = keyed(looked(draw, at))
	const before = keyed(before_of(draw, at, since))

	return [...now]
		.filter(([key, bytes]) => before.get(key) !== bytes)
		.map(([, bytes]) => bytes)
		.join('')
}

function write_panel(
	draw: PanelDraw | undefined,
	ports: PanelPorts,
	at: PanelMoment,
	since: PanelMoment | undefined,
): void {
	const bytes = draw === undefined ? '' : panel_bytes(draw, at, since)

	if (bytes === '') return
	const write = ports.write_drawn ?? ports.write

	write(run_board_screen.synced(bytes))
}

// The next tick the area is drawn on after `now_ms`, none with no area out or a painter that does not
// tick.
function tick_after(draw: PanelDraw | undefined, now_ms: number): number {
	if (draw?.painter.is_ticking !== true) return Infinity

	return now_ms - (now_ms % PANEL_TICK_MS) + PANEL_TICK_MS
}

const run_board_panel_draw = {
	AREA_ROWS,
	PANEL_TICK_MS,
	area_of,
	cell_bytes,
	looked,
	panel_bytes,
	tick_after,
	write_panel,
}

export { run_board_panel_draw }
export type { PanelArea, PanelCell, PanelDraw, PanelMoment, PanelPainter }
