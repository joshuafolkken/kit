import { run_board_cells, type Cells } from './run-board-cells'
import type { Cell, Grid } from './run-board-theme-host-types'

// A board's cells read back as the theme host's roles (joshuafolkken/kit#8917). A themed live board
// draws its base in the matrix theme's palette — the palette the confirmed demo's frame was captured
// in — so each color names exactly one role here, and no text is read to find one. The theme then
// paints every role in its own colors.

const { CONTINUATION, char_text, style_of } = run_board_cells
const ESC = '\u{1B}['
const COLOR_PREFIX = '38;2;'.length
// eslint-disable-next-line no-control-regex -- an SGR opens with ESC
const COLOR_SGR = /\u{1B}\[(38;2;\d+;\d+;\d+|32)m/gu
const NAMED_GREEN = '32'

// The matrix theme's colors, read as roles.
const ROLE_OF_COLOR: ReadonlyMap<string, string> = new Map([
	['0;215;60', 'body'],
	['0;165;40', 'body'],
	['0;100;22', 'rule'],
	['0;55;12', 'rule'],
	['0;255;65', 'ok'],
	['48;209;88', 'ok'],
	['255;69;58', 'red'],
	['255;214;10', 'warn'],
	['255;255;255', 'hi'],
	['225;255;225', 'hi'],
])

// The role of the last foreground a style sets; its body where it sets none the table knows.
function role_of(style: string): string {
	const last = [...style.matchAll(COLOR_SGR)].map((match) => match[1]).at(-1) ?? ''

	if (last === NAMED_GREEN) return 'ok'

	return ROLE_OF_COLOR.get(last.slice(COLOR_PREFIX)) ?? 'body'
}

// A cell's style as a role key ('body', 'rule:dim', 'hi:bold').
function key_of(style: string): string {
	const role = role_of(style)
	const reset = style.lastIndexOf(`${ESC}22m`)

	if (style.lastIndexOf(`${ESC}2m`) > reset) return `${role}:dim`
	if (style.lastIndexOf(`${ESC}1m`) > reset) return `${role}:bold`

	return role
}

// The role key of a style id, read once per id.
function key_of_id(id: number, known: Map<number, string>): string {
	const seen = known.get(id)

	if (seen !== undefined) return seen
	const key = key_of(style_of(id).sgr)

	known.set(id, key)

	return key
}

// A wide character's second cell has no character of its own: '' in the grid.
function cell_at(cells: Cells, index: number, known: Map<number, string>): Cell {
	const char = cells.chars[index] ?? CONTINUATION
	const text = char === CONTINUATION ? '' : char_text(char)

	return [text, key_of_id(cells.styles[index] ?? 0, known)]
}

// Every cell of `cells` as [character, role key], row by row.
function grid_of(cells: Cells): Grid {
	const known = new Map<number, string>()

	return Array.from({ length: cells.rows }, (_, y) =>
		Array.from({ length: cells.columns }, (_unused, x) =>
			cell_at(cells, y * cells.columns + x, known),
		),
	)
}

const run_board_theme_roles = { ROLE_OF_COLOR, grid_of, key_of, role_of }

export { run_board_theme_roles }
