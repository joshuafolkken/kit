import { run_board_theme_host_flash } from './run-board-theme-host-flash'
import { run_board_theme_host_fonts } from './run-board-theme-host-fonts'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_parts } from './run-board-theme-host-parts'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid, ThemeApi, ThemeLayout } from './run-board-theme-host-types'

// What the theme host hands a theme (joshuafolkken/kit#8917): the confirmed theme demo's `API`, its
// layout as one object and its helpers, those that need the layout bound to it.

const { blank_row, put, repeated } = run_board_theme_host_grid
const { blank_screen, tube_off, tube_on, tube_picture } = run_board_theme_host_parts

// The helpers that read nothing of the board's layout.
const LOOSE_HELPERS = {
	...run_board_theme_host_flash,
	active: run_board_theme_host_state.active,
	finished: run_board_theme_host_state.finished,
	hash: run_board_theme_host_hash.hash,
	eased: run_board_theme_host_parts.eased,
	banner: run_board_theme_host_fonts.banner,
	big_digit: run_board_theme_host_fonts.big_digit,
	big_number: run_board_theme_host_fonts.big_number,
	big_width: run_board_theme_host_fonts.big_width,
	bg: run_board_theme_host_grid.bg,
	block: run_board_theme_host_grid.block,
	cell_at: run_board_theme_host_grid.cell_at,
	centered: run_board_theme_host_grid.centered,
	digit: run_board_theme_host_grid.digit,
	dimmed: run_board_theme_host_grid.dimmed,
	fg: run_board_theme_host_grid.fg,
	framed: run_board_theme_host_grid.framed,
	is_rule: run_board_theme_host_grid.is_rule,
	pick: run_board_theme_host_grid.pick,
	put,
	rect_frame: run_board_theme_host_grid.rect_frame,
	restyle: run_board_theme_host_grid.restyle,
	set_cell: run_board_theme_host_grid.set_cell,
	tear: run_board_theme_host_grid.tear,
}

// Blanks the event area, or the columns of it from x0 up to x1.
function clear_area(grid: Grid, layout: ThemeLayout, x0: number, x1: number): void {
	for (let y = layout.area_top; y <= layout.area_end; y++) {
		put(grid, { y, x: x0 }, repeated(' ', x1 - x0), 'body')
	}
}

// A row of a grid as text, a cell a character: a wide character's second cell ('') reads as a blank,
// so the text's columns are the grid's.
function plain_of(board: Grid, y: number): string {
	return (board[y] ?? []).map(([ch]) => ch || ' ').join('')
}

// The helpers for `layout` and `board` (the frame's untouched cells, which a theme only reads).
function theme_api_of(layout: ThemeLayout, board: Grid): ThemeApi {
	return {
		...LOOSE_HELPERS,
		layout,
		board,
		plain: (y) => plain_of(board, y),
		clear_area: (grid, x0 = 0, x1 = layout.edge) => {
			clear_area(grid, layout, x0, x1)
		},
		blank_row: (grid, y) => {
			blank_row(grid, y, layout.w)
		},
		blank_screen: (grid) => {
			blank_screen(grid, layout)
		},
		tube_picture: (grid, half, glow) => {
			tube_picture(grid, layout, half, glow)
		},
		tube_on: tube_on(layout),
		tube_off: tube_off(layout),
	}
}

const run_board_theme_host_api = { plain_of, theme_api_of }

export { run_board_theme_host_api }
