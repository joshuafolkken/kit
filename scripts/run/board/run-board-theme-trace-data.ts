import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type {
	Grid,
	ThemeApi,
	ThemeColors,
	ThemeLayout,
	ThemeState,
} from './run-board-theme-host-types'

// MATRIX's tables (joshuafolkken/kit#8917), the board's own code-rain theme, from the confirmed theme
// demo (`fixed-v21-theme-matrix.mjs`): its shades, glyphs, rain paces, the noise salts each effect
// draws its numbers with, the opening's lines, and the shapes its drawing passes between parts.

const { code_points } = run_board_theme_host_grid

// SHADES (run-board-header-trace.ts), each 'r;g;b'.
const SHADE = {
	head: '225;255;225',
	bright: '0;255;65',
	body: '0;215;60',
	mid: '0;165;40',
	dark: '0;100;22',
	darkest: '0;55;12',
	ember: '0;22;5',
}
const RED = '255;69;58'
const COLORS: ThemeColors = {
	body: SHADE.body,
	rule: SHADE.mid,
	ok: '48;209;88',
	red: RED,
	warn: '255;214;10',
	hi: '255;255;255',
	type: SHADE.body,
	notice: SHADE.bright,
}
const GLYPHS: ReadonlyArray<string> = code_points(
	'ｦｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789Z:.=*+<>',
)
const FLASH: ReadonlyArray<string> = code_points('ｦｱｳｴｵｶｷｹｺｻ')
// The three head cells, white to green; the tail eased from bright to ember in five steps.
const HEAD_RGB: ReadonlyArray<string> = [SHADE.head, '124;255;153', '45;255;97']
const TAIL = { steps: 5, ease: 1.8 }
const FLICKER_CELLS = 2
const LIT_TRAIL = 2
// A cell's own seed in the noise, and the settled glyph a trail cell keeps.
const CELL_KEY = { x: 131 }
const SETTLED = { x: 31, y: 17 }

// The idle panel rain (run-board-idle-rain.ts): its frame, its paces, the gap between drops, its
// trail, every other column of the panel from its sixth row; while a line types every drop pours.
const IDLE = {
	frame_ms: 70,
	pace: { least: 0.12, spread: 0.22 },
	gap: { least: 6, spread: 10 },
	trail: 3,
	// An offset from the area's top (joshuafolkken/kit#8917; the demo's area_top was 4).
	top: 1,
	pitch: 2,
}
const POUR = { per_step: 4, least: 0.6, spread: 0.5, gain: 2, floor: 1.2 }
const DROP_FILM = { least: 0.4, spread: 0.6 }
const PROGRESS_TAIL = 6
const PROGRESS_RAIN = 0.6
const NOTICE_POUR = { least: 2, most: 14, burst: 20, burst_steps: 20, after: 8, after_steps: 30 }
// A pour's drop keys: 32 a step; a second's drop key: 8 a second plus 7.
const KEYS = { per_step: 32, per_second: 8, second_offset: 7 }
// The salts a pour's drops pick their column and their trail with: the pour's own and six past it.
const FILM_SALT_SHIFT = 6
const POUR_SALT = { progress: 1, row: 2, notice: 3 }
const SECOND_SALTS = { x: 1, film: 6 }
// The noise's third number for each effect, and the second where one effect draws several.
const SALT = {
	idle: 61,
	drop: 71,
	pour: 73,
	second: 79,
	decode: 91,
	reroll: 92,
	lock: 93,
	deja: 95,
	swap: 96,
	flash: 97,
}
const IDLE_SALT = { pace: 1, gap: 2, phase: 3 }
const DROP_SALT = { pace: 5 }
const POUR_JITTER = { progress: 11, notice: 9 }
const SECOND_PACE_SALT = 2
// The decode's per-frame reroll chance (run-board-decode.ts).
const REROLL = 0.08
const HEADER_ROWS = 3

// One drop of the rain: the row its head is on, its trail, the frame its glyphs flicker with, and
// whether it paints code over the board's own characters.
interface Drop {
	row: number
	trail: number
	frame: number
	covers?: boolean | undefined
}

// The column a drop falls in: its top row and its rows, and whether the cells no rain may touch hold.
interface Column {
	x: number
	top: number
	rows: number
	guard?: boolean
}

// A header or lane clock: its row, its cells from `left` up to `right`, and its seconds on the board.
interface ClockField {
	y: number
	left: number
	right: number
	base: number
}

// What the theme reads off the board once: the new lane's last character and the running clocks.
interface TraceBoard {
	api: ThemeApi
	layout: ThemeLayout
	row_last: number
	clock_fields: ReadonlyArray<ClockField>
}

// One frame being drawn.
interface TraceView extends TraceBoard {
	grid: Grid
	s: ThemeState
	tick: number
}

const run_board_theme_trace_data = {
	CELL_KEY,
	COLORS,
	DROP_FILM,
	DROP_SALT,
	FILM_SALT_SHIFT,
	FLASH,
	FLICKER_CELLS,
	GLYPHS,
	HEADER_ROWS,
	HEAD_RGB,
	IDLE,
	IDLE_SALT,
	KEYS,
	LIT_TRAIL,
	NOTICE_POUR,
	POUR,
	POUR_JITTER,
	POUR_SALT,
	PROGRESS_RAIN,
	PROGRESS_TAIL,
	RED,
	REROLL,
	SALT,
	SECOND_PACE_SALT,
	SECOND_SALTS,
	SETTLED,
	SHADE,
	TAIL,
}

export { run_board_theme_trace_data }
export type { ClockField, Column, Drop, TraceBoard, TraceView }

export { type Cell } from './run-board-theme-host-types'
