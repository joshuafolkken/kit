import { run_board_cells, type Cells } from './run-board-cells'
import { run_board_cells_ansi } from './run-board-cells-ansi'
import type { TerminalSize } from './run-board-fit'
import type { Lamp } from './run-board-lamp-spots'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { ThemeFactory, ThemeModule } from './run-board-theme-host-types'
import type { LayoutView } from './run-board-theme-layout'
import { run_board_theme_run, type ThemeRun } from './run-board-theme-run'
import type { KeyedLine } from './run-board-type-rows'

// A small live board for the theme layer's tests (joshuafolkken/kit#8917): its base text in the
// matrix palette, the places kit laid out on it, and a stand-in theme that writes its tick at the top
// right, so a frame's moment can be read off the screen.

const ESC = '\u{1B}'
const BODY = `${ESC}[38;2;0;215;60m`
const RULE = `${ESC}[38;2;0;100;22m`
const RESET = `${ESC}[0m`
const LINK = 'https://github.com/joshuafolkken/kit/issues/8899'
// The board's rules run to column 99, its lamp panel from column 44 on seven rows from row 6 (1-based):
// the smallest panel a theme draws on is six rows and forty columns (`run-board-theme-layout.ts`).
const SIZE: TerminalSize = { rows: 17, columns: 100 }
const RULE_END = 99
const PANEL_ROWS = 7
const FIRST_LAMP_ROW = 6
const LAMP_COLUMN = 44
const LAMPS_PER_ROW = 2
const TICK_AT = { y: 0, x: 40 }
const COLORS = {
	body: '1;2;3',
	hi: '4;5;6',
	notice: '7;8;9',
	ok: '10;11;12',
	red: '13;14;15',
	rule: '16;17;18',
	type: '19;20;21',
	warn: '22;23;24',
}

function linked(text: string): string {
	return `${ESC}]8;;${LINK}${ESC}\\${text}${ESC}]8;;${ESC}\\`
}

// A section's rule, `label` at its left and `tail` at its right, run on to the board's 99 columns.
function rule(label: string, tail = ''): string {
	const lead = '-- -- '.concat(label, ' ')

	return `${RULE}${lead.padEnd(RULE_END - tail.length, '-')}${tail}`
}

const LINES = [
	`${BODY}  josh-trace   11-24 23:03`,
	`${BODY}  v1.0         11-24 19:10   🔊 all calm`,
	`${BODY}  kit          11-23 18:46   >  #8897 · Bash pnpm josh gate`,
	'',
	rule('throughput', ' TRACE ■----'),
	`${BODY}     24h  ▁▃▃█▆▅   2.2    14h`,
	`${BODY}      7d  ▃█▇█▄▆   3.9   124h`,
	'',
	rule('usage'),
	`${BODY}     Claude    7d  81%`,
	`${BODY}     Codex     7d  28%`,
	`${BODY}     GitHub  REST   5%`,
	'',
	rule('lanes 1/3'),
	`${BODY}  ⠋  SH  ${linked('8899')} ** Carry run:board render cost`,
	'',
	`${BODY}  done${RESET}`,
]

// The panel's lamps kit laid out right of the THROUGHPUT rows (1-based), two a row on its seven rows:
// the `24h` and `7d` rows, the blank under them, the usage rule and its three rows.
const LAMPS: ReadonlyArray<Lamp> = Array.from({ length: PANEL_ROWS }, (_, panel_row) =>
	Array.from({ length: LAMPS_PER_ROW }, (__, lamp) => ({
		row: FIRST_LAMP_ROW + panel_row,
		column: LAMP_COLUMN + lamp,
		panel_row,
		panel_rows: PANEL_ROWS,
		group: 0,
		lamp,
	})),
).flat()
// The header's keyed rows run to column 55, their words from column 32; the lane's from column 5.
const WIDTHS = { header: 55, lane: 50 }
const HEADER_TEXT = ' '.repeat(WIDTHS.header)
const KEYED: ReadonlyArray<KeyedLine> = [
	{ key: 'notice:all calm', index: 1, row: 2, text: HEADER_TEXT, prefix_columns: 32 },
	{ key: 'now:#8897', index: 2, row: 3, text: HEADER_TEXT, prefix_columns: 32 },
	{ key: 'lanes:8899', index: 14, row: 15, text: ' '.repeat(WIDTHS.lane), prefix_columns: 5 },
]

const VIEW: LayoutView = {
	lamps: LAMPS,
	keyed: KEYED,
	colons: [{ row: 1, column: 18, style: '' }],
	spots: [
		{ row: 3, column: 15, style: '' },
		{ row: 15, column: 3, style: '' },
	],
}

// The base painted onto a canvas of `size`, as the frame loop's base layer leaves it.
function base_canvas(size: TerminalSize = SIZE): Cells {
	const cells = run_board_cells.cells_of(size)

	run_board_cells_ansi.paint(cells, LINES.join('\n'))

	return cells
}

// A theme that draws nothing but its tick, top right.
function ticking(): ThemeModule {
	return {
		name: 'TEST',
		colors: COLORS,
		draw: (grid, _state, tick) => {
			run_board_theme_host_grid.put(grid, TICK_AT, String(tick), 'hi')
		},
	}
}

const TICKING: ThemeFactory = ticking

// A run of the stand-in theme past its opening, its ticks counted from `origin_ms`.
function ticking_run(origin_ms: number): ThemeRun {
	const run = run_board_theme_run.run_of('wopr', () => TICKING)

	run.origin_ms = origin_ms
	run.part = undefined

	return run
}

// The characters of row `y` (0-based).
function row_text(cells: Cells, y: number): string {
	const row = cells.chars.subarray(y * cells.columns, (y + 1) * cells.columns)

	return [...row].map((char) => run_board_cells.char_text(char)).join('')
}

const run_board_theme_layer_fixture = {
	LINK,
	SIZE,
	TICKING,
	TICK_AT,
	VIEW,
	base_canvas,
	row_text,
	ticking_run,
}

export { run_board_theme_layer_fixture }
