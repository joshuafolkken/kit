import type {
	Area,
	Box,
	Cell,
	CellTest,
	Corners,
	Grid,
	Point,
	Spot,
	StyleAt,
} from './run-board-theme-host-types'

// The theme host's drawing helpers (joshuafolkken/kit#8917), ported from the confirmed theme demo. A
// grid's rows are each as wide as the screen, so a write clips to its row: the demo's `W`.

const ESC = '\u{1B}['
const BOLD = `${ESC}1m`
const DIM = `${ESC}2m`
const HEADER_ROWS = 3
const DIGIT_SCALE = 10
const HALF = 2
// A frame's top rule: its two corners, the dash and the spaces either side of its label.
const LABEL_TRIM = 5
const SIDES = 2
const BLANK_CELL: Cell = [' ', 'body']

function fg(color: string): string {
	return `${ESC}38;2;${color}m`
}

function bg(color: string): string {
	return `${ESC}48;2;${color}m`
}

// A text's code points, one a cell, as the demo split its text (not its graphemes).
function code_points(text: string): Array<string> {
	return Array.from(text, (point) => point)
}

// `line` as `width` cells in one style, padded or cut to that width.
function row_of(line: string, style: string, width: number): Array<Cell> {
	return code_points(line.padEnd(width))
		.slice(0, width)
		.map((ch): Cell => [ch, style])
}

function pick<T>(list: ArrayLike<T>, value: number): T {
	const item = list[Math.floor(value * list.length) % list.length]

	if (item === undefined) throw new Error('pick: the list is empty')

	return item
}

function put_cell(row: Array<Cell>, x: number, ch: string, style: string | undefined): void {
	const cell = row[x]

	if (!cell || x < 0) return
	row[x] = [ch, style ?? cell[1]]
}

// `text` from `at` in `style`, or in each cell's own style when none is given; off the row is dropped.
function put(grid: Grid, at: Point, text: string, style?: string): void {
	const row = grid[at.y]

	if (!row) return

	for (const [index, ch] of code_points(text).entries()) put_cell(row, at.x + index, ch, style)
}

// Where a level reading `width` wide starts so its last letter sits in the rule's last column, the
// level spot's right end, in every theme and every state (joshuafolkken/kit#8917, kit only).
function level_x(spot: Spot, width: number): number {
	return Math.max(0, spot.x + spot.w - width)
}

// A level reading in one style, flush with the rule's right end; the rule runs on to its left.
function put_level(grid: Grid, spot: Spot, text: string, style: string): void {
	put(grid, { y: spot.y, x: level_x(spot, code_points(text).length) }, text, style)
}

function restyle_row(row: Array<Cell>, y: number, is_match: CellTest, style_at: StyleAt): void {
	for (const [x, cell] of row.entries()) {
		if (is_match(cell, x, y)) row[x] = [cell[0], style_at(x, y, cell)]
	}
}

// Every cell `is_match` picks takes the style `style_at` gives it.
function restyle(grid: Grid, is_match: CellTest, style_at: StyleAt): void {
	for (const [y, row] of grid.entries()) restyle_row(row, y, is_match, style_at)
}

function is_rule([, style]: Cell): boolean {
	return style.startsWith('rule')
}

function digit(seed: number): string {
	return String(Math.floor(seed * DIGIT_SCALE))
}

function centered(text: string, width: number): string {
	return text.padStart(Math.floor((width + text.length) / HALF)).padEnd(width)
}

// `text` `count` times; none for a count below 0 — a width worked out from a narrow board's layout
// never throws (joshuafolkken/kit#8917).
function repeated(text: string, count: number): string {
	return text.repeat(Math.max(0, count))
}

// `grid` down to row `last`: the grid's own rows, none below it, so a part drawn at a fixed height —
// seven panel rows, as the demo's area has — stops at an area's last row instead of painting over the
// section under it (joshuafolkken/kit#8917).
function rows_to(grid: Grid, last: number): Grid {
	return grid.slice(0, Math.max(0, last + 1))
}

// Blanks a borrowed header block, all three rows, in one style.
function block(grid: Grid, area: Area, style: string): void {
	for (let y = 0; y < HEADER_ROWS; y++) put(grid, { y, x: area.x }, repeated(' ', area.w), style)
}

// Row `y` slips `shift` cells right (left when negative), its edge cells repeating.
function tear(grid: Grid, y: number, shift: number): void {
	const row = grid[y]

	if (!row) return
	grid[y] = row.map((cell, x) => row[Math.min(row.length - 1, Math.max(0, x - shift))] ?? cell)
}

// Row `y` emptied: `width` blank cells; a row off the grid (an area past the frame) is not added.
function blank_row(grid: Grid, y: number, width: number): void {
	if (y < 0 || y >= grid.length) return
	grid[y] = row_of('', 'body', width)
}

function cell_at(grid: Grid, y: number, x: number): Cell {
	return grid[y]?.[x] ?? BLANK_CELL
}

function set_cell(grid: Grid, at: Point, cell: Cell): void {
	const row = grid[at.y]

	if (row) row[at.x] = cell
}

function raise_row(row: Array<Cell>): void {
	for (const [x, cell] of row.entries()) {
		const raised = cell[0].toUpperCase()

		if (raised !== cell[0] && raised.length === 1) row[x] = [raised, cell[1]]
	}
}

// A theme that draws in capitals shows every letter of the board raised.
function in_capitals(grid: Grid): void {
	for (const row of grid) raise_row(row)
}

// Every cell with a character on it, in one style: the board dimmed or washed.
function dimmed(grid: Grid, style: string): void {
	restyle(
		grid,
		([ch]) => ch !== ' ',
		() => style,
	)
}

// A box with `label` in its top rule, its inside blanked.
function framed(grid: Grid, box: Box, label: string, style: string): void {
	const { x } = box

	put(
		grid,
		{ y: box.y, x },
		`┌─ ${label} ${repeated('─', box.w - LABEL_TRIM - label.length)}┐`,
		style,
	)

	for (let row = 1; row < box.h - 1; row++) {
		put(grid, { y: box.y + row, x }, `│${repeated(' ', box.w - SIDES)}│`, style)
	}

	put(grid, { y: box.y + box.h - 1, x }, `└${repeated('─', box.w - SIDES)}┘`, style)
}

// A box's outline from (x0, y0) to (x1, y1), its corners included, clipped to the screen.
function rect_frame(grid: Grid, corners: Corners, style: string): void {
	const { x0, y0, x1, y1 } = corners
	const inner = repeated('─', x1 - x0 + 1 - SIDES)

	put(grid, { y: y0, x: x0 }, `┌${inner}┐`, style)
	put(grid, { y: y1, x: x0 }, `└${inner}┘`, style)

	for (let y = y0 + 1; y < y1; y++) {
		put(grid, { y, x: x0 }, '│', style)
		put(grid, { y, x: x1 }, '│', style)
	}
}

// The color `share` of the way from `dark` to `bright`, both 'r;g;b'.
function mixed(dark: string, bright: string, share: number): string {
	const from = dark.split(';').map(Number)
	const to = bright.split(';').map(Number)

	return from
		.map((value, index) => Math.round(value + ((to[index] ?? value) - value) * share))
		.join(';')
}

// A gauge of `total` cells, the first `lit` filled and the rest empty; `lit` is held to 0..total and a
// total below 0 draws none, so a gauge cut to a narrow board never throws.
function cells_bar(lit: number, total: number): string {
	const room = Math.max(0, total)
	const filled = Math.min(room, Math.max(0, lit))

	return `${repeated('▮', filled)}${repeated('▯', room - filled)}`
}

const run_board_theme_host_grid = {
	BOLD,
	DIM,
	ESC,
	bg,
	blank_row,
	block,
	cell_at,
	cells_bar,
	centered,
	code_points,
	digit,
	dimmed,
	fg,
	framed,
	in_capitals,
	is_rule,
	level_x,
	mixed,
	pick,
	put,
	put_level,
	rect_frame,
	repeated,
	restyle,
	rows_to,
	row_of,
	set_cell,
	tear,
}

export { run_board_theme_host_grid }
