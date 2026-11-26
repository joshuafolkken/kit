import { readFileSync } from 'node:fs'
import { run_board_theme_host_api } from './run-board-theme-host-api'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import {
	run_board_theme_host_sample,
	type DemoEvent,
	type DemoKey,
} from './run-board-theme-host-sample'
import type {
	Cell,
	FinalGrid,
	Grid,
	Span,
	ThemeApi,
	ThemeLayout,
} from './run-board-theme-host-types'
import { run_board_theme_roles } from './run-board-theme-roles'

// The confirmed theme demo's board for the theme host's tests (joshuafolkken/kit#8917): its frame
// (`__snapshots__/run-board-theme-host-frame.ans`, a copy of the demo's `fixed-v21-frame.ans`) read
// into role cells exactly as the demo host reads it, the layout found by the host's own scanning,
// the load-time edits the host makes, the demo's events as timelines, and the demo's snap text.
// The screen is the demo's with no terminal: 60 rows, at most 199 columns.

const FRAME_URL = new URL('__snapshots__/run-board-theme-host-frame.ans', import.meta.url)
const ESC = '\u{1B}['
const SCREEN_ROWS = 60
const TERMINAL_COLUMNS = 200
// eslint-disable-next-line no-control-regex -- an SGR opens with ESC
const SGR_PARTS = /(\u{1B}\[[\d;]*m)/u
// The section rules end two rows apart from the area; pins are the last thirteen columns, the
// notice and progress end two before them, the progress words three past the notice.
// A lane's issue number is four digits; the panel's width is read off row 5; a clock's colon is two
// cells into it.
const PLACES = {
	pins: 13,
	before_pins: 2,
	words: 3,
	area_gap: 2,
	level: 18,
	row_x: 5,
	row_tail: 2,
	issue: 4,
	panel_row: 5,
	colon: 2,
	lane_spin_x: 2,
	header_rows: 3,
}
const HALF = 2
const CLOCK = /\d\d:\d\d/u
const SIGN = /\d\d:\d\d\s+[+-]/u

// The matrix theme's colors, read as roles (`run-board-theme-roles.ts`, the table the live board reads).
const { key_of } = run_board_theme_roles

// Each code point of `part` a cell in the style `key`.
function part_cells(part: string, key: string): Array<Cell> {
	const { code_points, row_of } = run_board_theme_host_grid

	return row_of(part, key, code_points(part).length)
}

function cells_of(line: string): Array<Cell> {
	const cells: Array<Cell> = []
	let style = ''

	for (const part of line.split(SGR_PARTS)) {
		const key = key_of(style)

		if (part.startsWith(ESC)) style += part
		else cells.push(...part_cells(part, key))
	}

	return cells
}

function board_of(frame: string): Grid {
	const lines = frame
		.split('\n')
		.slice(0, SCREEN_ROWS)
		.map((line) => cells_of(line))
	const widths = lines.slice(0, SCREEN_ROWS - 1).map((cells) => cells.length)
	const width = Math.min(TERMINAL_COLUMNS - 1, Math.max(...widths))
	const blank = run_board_theme_host_grid.row_of('', 'body', width)

	return lines.map((cells) => [...cells, ...blank].slice(0, width))
}

function plain_rows(board: Grid): Array<string> {
	return board.map((_, y) => run_board_theme_host_api.plain_of(board, y))
}

// A place found from the frame's structure; a frame without it is not a board the host knows.
function found(what: string, x: number): number {
	if (x < 0) throw new Error(`Not found in the frame: ${what}`)

	return x
}

function row_starting(rows: Array<string>, title: string): number {
	const y = rows.findIndex((line) => line.toLowerCase().startsWith(`-- -- ${title}`))

	return found(`the ${title} rule`, y)
}

function text_at(rows: Array<string>, y: number): string {
	return rows[y] ?? ''
}

type Sections = Pick<ThemeLayout, 'area_end' | 'area_top' | 'edge'> & { lanes_rule: number }

function sections_of(rows: Array<string>): Sections {
	const area_top = row_starting(rows, 'throughput')
	const lanes_rule = row_starting(rows, 'lanes')

	return {
		area_top,
		lanes_rule,
		area_end: lanes_rule - PLACES.area_gap,
		edge: text_at(rows, area_top).trimEnd().length,
	}
}

type Header = Pick<
	ThemeLayout,
	'column_x' | 'head_left' | 'head_right' | 'head_top' | 'notice' | 'pins_x' | 'progress'
>

function header_of(rows: Array<string>, edge: number): Header {
	const column_x = found(
		'the machine gauges on row 1',
		text_at(rows, 0).search(/\b(?:CPU|MM|SW)\s+\d+%/iu),
	)
	const pins_x = edge - PLACES.pins
	const end = pins_x - PLACES.before_pins

	return {
		column_x,
		pins_x,
		notice: { y: 1, x: column_x, end },
		progress: { y: 2, x: column_x + PLACES.words, end },
		head_left: { x: 0, w: column_x - 1 },
		head_right: { x: pins_x, w: edge - pins_x },
		head_top: { x: column_x, w: end - column_x },
	}
}

type Lanes = Pick<
	ThemeLayout,
	'issue_x' | 'lane_rows' | 'lane_spin_rows' | 'new_lane' | 'row' | 'row_text'
>

function lane_row_span(rows: Array<string>, lanes_rule: number): Span {
	const lane_end = rows.findIndex((line, y) => y > lanes_rule && line.trim() === '')
	const y = found('the blank row after the lanes', lane_end) - 1

	return { y, x: PLACES.row_x, end: text_at(rows, y).trimEnd().length + PLACES.row_tail }
}

function lanes_of(rows: Array<string>, lanes_rule: number): Lanes {
	const row = lane_row_span(rows, lanes_rule)
	const lane_rows = Array.from({ length: row.y - lanes_rule }, (_, index) => lanes_rule + 1 + index)
	const first = text_at(rows, lane_rows[0] ?? -1)
	const issue_x = found(
		'a lane issue number',
		first.search(/\b\d{4,5}\s+(?:P\d\s+)?(?:\*\*|BG)\s/u),
	)
	const row_line = text_at(rows, row.y)

	return {
		row,
		lane_rows,
		// The demo's still screen turns a spinner on every lane row.
		lane_spin_rows: lane_rows,
		issue_x,
		new_lane: row_line.slice(issue_x, issue_x + PLACES.issue),
		row_text: row_line.slice(row.x).trimEnd(),
	}
}

type Panel = Pick<ThemeLayout, 'level_spot' | 'pw' | 'px'>

// The panel a theme keeps while idle, right of the 24h row's end, and its level spot at the
// THROUGHPUT rule's right end.
function panel_of(rows: Array<string>, sections: Sections): Panel {
	const px = text_at(rows, PLACES.panel_row).trimEnd().length + 1
	const { edge, area_top } = sections

	return { px, pw: edge - px, level_spot: { y: area_top, x: edge - PLACES.level, w: PLACES.level } }
}

// Under the panel a usage row loses a stale reading's age and the GitHub GQL column.
function cleared_from(line: string, px: number): number {
	const aside = line.search(/\s\d+′\s*$/u)

	if (aside >= 0) return aside
	const gql = line.search(/> GQL/iu)

	return gql >= 0 ? Math.min(gql, px - 1) : px - 1
}

function clear_row(row: Array<Cell>, from: number): void {
	for (let x = from; x < row.length; x++) row[x] = [' ', 'body']
}

// The host's load-time edits: the rows under the panel cleared, and the frame's own level display
// on the THROUGHPUT rule taken out (the rule runs on through its place).
function edit_board(board: Grid, places: Sections & Panel): void {
	for (let y = places.area_top + 1; y <= places.area_end; y++) {
		clear_row(board[y] ?? [], cleared_from(run_board_theme_host_api.plain_of(board, y), places.px))
	}

	const rule = board[places.level_spot.y] ?? []

	for (let x = places.level_spot.x - 1; x < places.edge; x++) rule[x] = ['-', 'rule']
}

type Finish = Pick<ThemeLayout, 'gap_rows' | 'head_colons' | 'last_text_row' | 'sign_x'>

function sign_x_of(rows: Array<string>): number {
	const match = SIGN.exec(text_at(rows, 0)) ?? SIGN.exec(text_at(rows, 1))

	return match ? match.index + match[0].length - 1 : -1
}

// A blank row between two sections, outside the area and above the last row of text.
function is_gap(line: string, y: number, gap: Sections & { last_text_row: number }): boolean {
	if (y >= gap.last_text_row || line.trim() !== '') return false

	return y < gap.area_top || y > gap.area_end
}

// What the host reads off the edited board: its last row of text, the blank rows between sections
// outside the area, the header clocks' colons and the signs column.
function finish_of(rows: Array<string>, sections: Sections): Finish {
	const last_text_row = rows.findLastIndex((line) => line.trim() !== '')
	const header = Array.from({ length: PLACES.header_rows }, (_, y) => y)
	const colons = header.map((y) => ({ y, x: text_at(rows, y).search(CLOCK) + PLACES.colon }))
	const gap = { last_text_row, ...sections }

	return {
		last_text_row,
		gap_rows: rows.map((_, y) => y).filter((y) => is_gap(text_at(rows, y), y, gap)),
		head_colons: colons.filter(({ x }) => x > 1),
		sign_x: sign_x_of(rows),
	}
}

// The layout the demo host finds in `board`, which it edits as the host does on load.
function layout_of(board: Grid): ThemeLayout {
	const rows = plain_rows(board)
	const { lanes_rule, ...sections } = sections_of(rows)
	const panel = panel_of(rows, { lanes_rule, ...sections })

	edit_board(board, { lanes_rule, ...sections, ...panel })

	return {
		...sections,
		...panel,
		...header_of(rows, sections.edge),
		...lanes_of(rows, lanes_rule),
		...finish_of(plain_rows(board), { lanes_rule, ...sections }),
		h: SCREEN_ROWS,
		w: board[0]?.length ?? 0,
		lane_spin_x: PLACES.lane_spin_x,
		screen_cx: Math.floor(sections.edge / HALF),
		screen_cy: Math.floor(SCREEN_ROWS / HALF),
	}
}

interface DemoHost {
	layout: ThemeLayout
	board: Grid
	api: ThemeApi
	events: Record<DemoKey, DemoEvent>
}

function host_of(frame: string): DemoHost {
	const board = board_of(frame)
	const layout = layout_of(board)
	const api = run_board_theme_host_api.theme_api_of(layout, board)

	return { layout, board, api, events: run_board_theme_host_sample.demo_events(layout.row_text) }
}

// The demo's board, layout, api and events, read once.
const HOST = host_of(readFileSync(FRAME_URL, 'utf8'))

// The demo's DEMO_SNAP text of a frame: each row's characters, cut two past the board's edge and
// trimmed at the end.
function snap_text(frame: FinalGrid, edge: number = HOST.layout.edge): string {
	const rows = frame.map((row) => row.map(([ch]) => ch).join(''))

	return rows.map((line) => line.slice(0, edge + PLACES.row_tail).trimEnd()).join('\n')
}

const run_board_theme_host_fixture = { HOST, snap_text }

export { run_board_theme_host_fixture }
export type { DemoHost }
