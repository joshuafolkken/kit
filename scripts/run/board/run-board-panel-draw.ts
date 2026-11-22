import { run_board_fit } from './run-board-fit'
import { run_board_labels, type Paint } from './run-board-labels'
import type { Lamp } from './run-board-lamp-spots'
import { run_board_screen } from './run-board-screen'
import type { BoardPorts } from './run-board-state'

// joshuafolkken/kit#8676: the animation area a theme draws its own cells in — the throughput rule's row and
// the six under it (the `24h` and `7d` rows, the blank line, the usage rule and its first two rows), up to
// the rule's end. The theme hands a painter (`ThemeDefinition.panel`); this module places the area, wakes
// the turn every `PANEL_TICK_MS` where the painter ticks and writes only the cells that changed, past the
// theme (`write_drawn`).
// The area shows only where the frame lays out the lamp panel — a colored terminal, room for its lamps and
// the throughput rows on screen — so it is found from the frame's lamps.

const CSI = '\u{1B}['
const PANEL_TICK_MS = 50
// The throughput rule's row and the six under it.
const AREA_ROWS = 7
const FOREGROUND_RGB = `${CSI}38;2;`
const BACKGROUND_RGB = `${CSI}48;2;`
const DEFAULT_FOREGROUND = `${CSI}39m`
const DEFAULT_BACKGROUND = `${CSI}49m`

// The moment a painter draws at, and whether a row is typing then.
interface PanelMoment {
	ms: number
	is_burst: boolean
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

// The frame's area found from its lamps on screen: the rule's row above the first lamp's, ended where that
// rule ends; none with no lamp on screen.
function area_of(
	lines: ReadonlyArray<string>,
	starts: ReadonlyArray<number>,
	lamps: ReadonlyArray<Lamp>,
): PanelArea | undefined {
	const [first] = lamps

	if (first === undefined) return undefined
	const rule = lines[starts.indexOf(first.row) - 1] ?? ''

	return { top: first.row - 1, end: run_board_fit.width_of(rule), rows: AREA_ROWS, lamps }
}

// `text` on `bg`: a shade as a 24-bit background where the terminal draws one, else no background — a
// named color is a foreground, which would repaint the text rather than back it.
function backed(bg: Paint | undefined, text: string): string {
	if (bg === undefined) return text
	const painted = run_board_labels.painted(bg, text)

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

// The cells that changed since `since` drawn as they are `at`, every one with no `since`.
function panel_bytes(draw: PanelDraw, at: PanelMoment, since: PanelMoment | undefined): string {
	const now = keyed(draw.painter.cells(draw.area, at))
	const before = keyed(since === undefined ? [] : draw.painter.cells(draw.area, since))

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
	panel_bytes,
	tick_after,
	write_panel,
}

export { run_board_panel_draw }
export type { PanelArea, PanelCell, PanelDraw, PanelMoment, PanelPainter }
