import { run_board_demo_lanes } from './run-board-demo-lanes'
import { run_board_fit, type TerminalSize } from './run-board-fit'
import type { Lamp } from './run-board-lamp-spots'
import type { Spot } from './run-board-spot'
import { run_board_theme_host_api } from './run-board-theme-host-api'
import type { Grid, Point, Span, ThemeLayout } from './run-board-theme-host-types'
import { run_board_theme_rules } from './run-board-theme-rules'
import type { KeyedLine } from './run-board-type-rows'
import { run_board_watch_panel } from './run-board-watch-panel'

// A live board's places as the theme host reads them (joshuafolkken/kit#8917), taken from kit's own
// layout rather than from the screen's words: the lamp panel kit lays out right of the THROUGHPUT and
// usage rows is the panel and area a theme draws in, the keyed rows (`run-board-row-key.ts`) are the
// header's notice and now line and the lanes, and the spinner and colon placeholders' spots are where
// the spinners turn and the colons blink. Every place is cut to the terminal, so a narrow pane or a
// short one never has a theme draw past its rows or columns. No lamp panel big enough on screen, the
// theme keeps its looks and its area lies past the frame (`area_panel`).

// What kit laid out on the frame a theme draws over: every position 1-based, as the spin records them.
interface LayoutView {
	lamps: ReadonlyArray<Lamp>
	keyed: ReadonlyArray<KeyedLine>
	colons: ReadonlyArray<Spot>
	spots: ReadonlyArray<Spot>
	row_key?: string | undefined
	// The header's three clocks always dated (`run-board-clocks.ts` dated_of); none off a live board.
	dated_clocks?: ReadonlyArray<string> | undefined
}

// The header's words end two columns short of the pins column; the level spot is the rule's last 18
// columns; a lane row's span runs two columns past its text.
const BEFORE_PINS = 2
const LEVEL_WIDTH = 18
const ROW_TAIL = 2
// The header's second and third rows carry the notice and the now line; the third the signs spinner.
const NOTICE_ROW = 1
const PROGRESS_ROW = 2
const SIGN_ROW = 2
const LANE_SPIN_X = 2
const HALF = 2
// The smallest panel a theme draws its area on (joshuafolkken/kit#8917); below it the area's parts are
// not drawn (the theme's looks stay). The themes were designed on the confirmed demo's board, whose area is the lamp panel's seven
// rows under its rule (AREA_TOP..AREA_END, eight rows) and whose panel is 46 columns wide: WARGAMES'
// lamps, LED and tic-tac-toe, BTTF's circuits and figure, MAGI's and CODEC's boxes are all drawn seven
// rows tall, side by side across the panel. A live board with no GitHub allowance read draws one usage
// row fewer, six panel rows (a real-data `board:replay` at 200×50): there a seven-row part reaches the
// blank line under the panel at most (WARGAMES and BTTF cut theirs at the area's last row), never the
// next section's rule. A shorter area — a short pane folding the usage section's lamp rows away — would
// have them paint over that section, so six panel rows are required. Forty columns keep every theme's
// panel parts side by side with room for a NOW column a few cells wider than the demo's (a live 200×50
// board's panel is 49), the themes cutting their parts at the panel's edge; a narrower pane, or one cut
// left of the lamps, has no area parts drawn.
const MIN_PANEL_ROWS = 6
const MIN_PANEL_WIDTH = 40
// No panel big enough: the area a theme draws in lies two rows past the frame — so a part's row just
// above it (BTTF's trail) is off the frame too — as tall as the demo's (eight rows) and as wide (46).
const OFF_FRAME = 2
const AREA_ROWS = 7
const PANEL_WIDTH = 46

function plain(board: Grid, y: number): string {
	return run_board_theme_host_api.plain_of(board, y)
}

function key_line(view: LayoutView, section: string): KeyedLine | undefined {
	return view.keyed.find((line) => line.key.startsWith(`${section}:`))
}

// A keyed row's typed span, 0-based: from its key to its text's end, cut to `edge`.
function span_of(line: KeyedLine, edge: number): Span {
	const end = Math.min(edge, run_board_fit.width_of(line.text))

	return { y: line.row - 1, x: Math.min(line.prefix_columns, end), end }
}

// The lamp panel: its rule's row, its last row, its first column and the rule's end.
interface Panel {
	area_top: number
	area_end: number
	px: number
	edge: number
}

function last_column(board: Grid, y: number): number {
	return plain(board, y).trimEnd().length
}

function panel_of(lamps: ReadonlyArray<Lamp>, board: Grid): Panel | undefined {
	const [first] = lamps

	if (first === undefined) return undefined
	const area_top = Math.max(0, Math.min(...lamps.map((lamp) => lamp.row)) - HALF)
	const area_end = Math.max(...lamps.map((lamp) => lamp.row)) - 1
	const px = Math.min(...lamps.map((lamp) => lamp.column)) - 1

	return { area_top, area_end, px, edge: last_column(board, area_top) }
}

type Header = Pick<
	ThemeLayout,
	'column_x' | 'head_left' | 'head_right' | 'head_top' | 'notice' | 'pins_x' | 'progress'
>

// The keyed row of `section` as a span on row `y`; another's columns, or none, where it is missing.
function header_span(view: LayoutView, section: string, edge: number): Span | undefined {
	const line = key_line(view, section)

	return line === undefined ? undefined : span_of(line, edge)
}

// The notice and the now line; either one missing takes the other's columns on its own row.
function header_spans(view: LayoutView, edge: number): { notice: Span; progress: Span } {
	const notice = header_span(view, 'notice', edge)
	const progress = header_span(view, 'now', edge)
	const words = notice ?? progress ?? { y: NOTICE_ROW, x: 0, end: 0 }

	return {
		notice: notice ?? { ...words, y: NOTICE_ROW },
		progress: progress ?? { ...words, y: PROGRESS_ROW },
	}
}

// The header's places as the confirmed demo lays them (joshuafolkken/kit#8917): the pins column is the
// rules' last columns (`run-board-watch-panel.ts`), and the notice and the now line run up to two
// columns short of it whatever their words' length, so a theme types its own words the field's width.
function header_of(view: LayoutView, edge: number): Header {
	const spans = header_spans(view, edge)
	// The keyed rows' words start on the machine column: their icons are words they type.
	const column_x = Math.max(1, Math.min(spans.notice.x, spans.progress.x))
	const pins_x = Math.max(column_x, edge - run_board_watch_panel.PANEL_WIDTH)
	const end = Math.max(column_x, pins_x - BEFORE_PINS)

	return {
		column_x,
		pins_x,
		notice: { ...spans.notice, end },
		progress: { ...spans.progress, end },
		head_left: { x: 0, w: column_x - 1 },
		head_right: { x: pins_x, w: edge - pins_x },
		head_top: { x: column_x, w: end - column_x },
	}
}

type Lanes = Pick<
	ThemeLayout,
	'issue_x' | 'lane_rows' | 'lane_spin_rows' | 'lane_spin_x' | 'new_lane' | 'row' | 'row_text'
>

// The lane a ROW types: the one `row_key` names where it is on screen, else the last lane.
function row_line(view: LayoutView, lanes: ReadonlyArray<KeyedLine>): KeyedLine | undefined {
	return lanes.find((line) => line.key === view.row_key) ?? lanes.at(-1)
}

function lane_spin_x_of(view: LayoutView, lane_rows: ReadonlyArray<number>): number {
	const spot = view.spots.find((each) => lane_rows.includes(each.row - 1))

	return spot === undefined ? LANE_SPIN_X : spot.column - 1
}

// The lane rows kit draws a spinner on (`run-board-render-lead.ts`: running lanes only); the others
// carry a mark or a blank there, which the theme must not cover. Demo mode's sample rows count as
// running lanes (`run-board-demo-lanes.ts`), as in the demo frame.
function lane_spin_rows_of(view: LayoutView, lanes: ReadonlyArray<KeyedLine>): Array<number> {
	const lane_rows = new Set(lanes.map((line) => line.row - 1))
	const spun = view.spots.map((spot) => spot.row - 1).filter((y) => lane_rows.has(y))
	const samples = lanes.filter((line) => run_board_demo_lanes.is_sample(line.key))

	return [...new Set([...spun, ...samples.map((line) => line.row - 1)])]
}

// The span a ROW types: its lane's row two columns past its text, within the terminal; with no lane, an
// empty span under the area.
function row_span(line: KeyedLine | undefined, panel: Panel, width: number): Span {
	if (line === undefined) return { y: panel.area_end + 1, x: 0, end: 0 }
	const span = span_of(line, width)

	return { ...span, end: Math.min(width, run_board_fit.width_of(line.text) + ROW_TAIL) }
}

// The lane's issue number, from its key, and where its row draws it.
function issue_of(line: KeyedLine | undefined, text: string, row: Span): { id: string; x: number } {
	const id = line === undefined ? '' : line.key.slice(line.key.indexOf(':') + 1)
	const x = id === '' ? -1 : text.indexOf(id)

	return { id, x: x < 0 ? row.x : x }
}

// The lanes: their rows, the row a ROW types and its issue number's place.
function lanes_of(view: LayoutView, board: Grid, panel: Panel): Lanes {
	const lanes = view.keyed.filter((line) => line.key.startsWith('lanes:'))
	const lane_rows = lanes.map((line) => line.row - 1).toSorted((first, second) => first - second)
	const line = row_line(view, lanes)
	const row = row_span(line, panel, board[0]?.length ?? 0)
	const text = plain(board, row.y)
	const issue = issue_of(line, text, row)

	return {
		row,
		lane_rows,
		lane_spin_x: lane_spin_x_of(view, lane_rows),
		lane_spin_rows: lane_spin_rows_of(view, lanes),
		issue_x: issue.x,
		new_lane: issue.id,
		row_text: text.slice(row.x).trimEnd(),
	}
}

function to_point(spot: Spot): Point {
	return { y: spot.row - 1, x: spot.column - 1 }
}

type Finish = Pick<
	ThemeLayout,
	'gap_rows' | 'head_colons' | 'last_text_row' | 'other_spins' | 'sign_x'
>

// The blank rows between sections outside the area and above the last row of text, the clocks'
// colons and the signs column's spinner.
function is_gap(line: string, y: number, bounds: Panel & { last_text_row: number }): boolean {
	if (line !== '' || y >= bounds.last_text_row) return false

	return y < bounds.area_top || y > bounds.area_end
}

// The spinners off the signs column's row and the lanes' rows, which the host turns on its own.
function other_spins_of(view: LayoutView, lane_rows: ReadonlyArray<number>): Array<Point> {
	const points = view.spots.map((spot) => to_point(spot))

	return points.filter((point) => point.y !== SIGN_ROW && !lane_rows.includes(point.y))
}

function finish_of(view: LayoutView, board: Grid, panel: Panel & Pick<Lanes, 'lane_rows'>): Finish {
	const rows = board.map((_, y) => plain(board, y).trim())
	const last_text_row = rows.findLastIndex((line) => line !== '')
	const bounds = { ...panel, last_text_row }
	const sign = view.spots.find((spot) => spot.row - 1 === SIGN_ROW)

	return {
		last_text_row,
		gap_rows: [...rows.keys()].filter((y) => is_gap(rows[y] ?? '', y, bounds)),
		head_colons: view.colons.map((spot) => to_point(spot)),
		sign_x: sign === undefined ? -1 : sign.column - 1,
		other_spins: other_spins_of(view, panel.lane_rows),
	}
}

// Whether `panel` is at least the smallest one a theme draws its area on.
function is_big_enough(panel: Panel): boolean {
	const rows = panel.area_end - panel.area_top

	return rows >= MIN_PANEL_ROWS && panel.edge - panel.px >= MIN_PANEL_WIDTH
}

// The area past the frame, level on the first rule: the board's right edge is that rule's end.
function off_frame_panel(board: Grid, size: TerminalSize): Panel & { level_y: number } {
	const [level_y = -1] = run_board_theme_rules.rule_rows_of(board)
	const edge = Math.min(last_column(board, level_y), size.columns)
	const area_top = size.rows + OFF_FRAME

	return {
		area_top,
		area_end: area_top + AREA_ROWS,
		px: Math.max(0, edge - PANEL_WIDTH),
		edge,
		level_y,
	}
}

// The panel a theme draws its area on: the lamp panel where it is big enough; else one past the last
// row (joshuafolkken/kit#8917). A folded section, a short pane or a narrow one leaves the theme its looks —
// colors, capitals, name, marks, spinner, level, rules and header — and drops only what draws in the
// area: every cell a theme puts there falls off the frame (`put` drops it), never half a part over the
// next section. The level stays on the lamp panel's rule, else on the first rule.
function area_panel(
	found: Panel | undefined,
	board: Grid,
	size: TerminalSize,
): Panel & { level_y: number } {
	if (found === undefined) return off_frame_panel(board, size)
	const edge = Math.min(found.edge, size.columns)
	const panel = { ...found, edge }

	if (!is_big_enough(panel)) return { ...off_frame_panel(board, size), level_y: found.area_top }

	return { ...panel, level_y: found.area_top }
}

// The LANES rule as kit keyed it: the plan's progress at the rule's end (`plan:…`).
function lanes_rule_of(
	view: LayoutView,
	board: Grid,
	lane_rows: ReadonlyArray<number>,
): number | undefined {
	const plan = key_line(view, 'plan')
	const rule_rows = run_board_theme_rules.rule_rows_of(board)

	return run_board_theme_rules.lanes_rule_of(rule_rows, plan && plan.row - 1, lane_rows)
}

// The layout of `board` (the base's role grid, `size` of the terminal) from what kit laid out.
function layout_of(view: LayoutView, board: Grid, size: TerminalSize): ThemeLayout | undefined {
	const panel = area_panel(panel_of(view.lamps, board), board, size)
	const { area_top, area_end, px, edge } = panel
	const lanes = lanes_of(view, board, panel)

	return {
		h: size.rows,
		w: size.columns,
		edge,
		px,
		pw: Math.max(0, edge - px),
		area_top,
		area_end,
		level_spot: { y: panel.level_y, x: Math.max(0, edge - LEVEL_WIDTH), w: LEVEL_WIDTH },
		...header_of(view, edge),
		...lanes,
		...finish_of(view, board, { ...panel, lane_rows: lanes.lane_rows }),
		screen_cx: Math.floor(edge / HALF),
		screen_cy: Math.floor(size.rows / HALF),
		lanes_rule: lanes_rule_of(view, board, lanes.lane_rows),
		dated_clocks: view.dated_clocks === undefined ? undefined : [...view.dated_clocks],
	}
}

function blank_from(board: Grid, y: number, x: number): void {
	const row = board[y] ?? []

	for (let at = Math.max(0, x); at < row.length; at++) row[at] = [' ', 'body']
}

// The lamp panel's columns blanked under its rule: a theme draws its panel there, and a panel too small
// for one is left empty rather than half lit.
function blank_panel(board: Grid, panel: Panel | undefined): void {
	if (panel === undefined) return

	for (let y = panel.area_top + 1; y <= panel.area_end; y++) blank_from(board, y, panel.px - 1)
}

// The host's own edits of the base before a theme draws: the lamp panel's columns blanked and the rule
// run on through the level spot, where each theme shows its own level.
function edit_board(board: Grid, layout: ThemeLayout, view?: LayoutView): void {
	blank_panel(board, view === undefined ? layout : panel_of(view.lamps, board))
	const rule = board[layout.level_spot.y] ?? []

	for (let x = Math.max(0, layout.level_spot.x - 1); x < Math.min(layout.edge, rule.length); x++) {
		rule[x] = ['-', 'rule']
	}
}

const run_board_theme_layout = { MIN_PANEL_ROWS, MIN_PANEL_WIDTH, edit_board, layout_of }

export { run_board_theme_layout }
export type { LayoutView }
