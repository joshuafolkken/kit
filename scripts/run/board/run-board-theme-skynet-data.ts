import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type {
	EventKey,
	Grid,
	ThemeApi,
	ThemeColors,
	ThemeState,
} from './run-board-theme-host-types'

// One frame being drawn: what the host handed the theme, the grid, the state and the tick.
interface SkynetDraw {
	api: ThemeApi
	grid: Grid
	s: ThemeState
	tick: number
}

// The TERMINATOR theme's tables (joshuafolkken/kit#8917), ported from the confirmed theme demo
// (`fixed-v21-theme-demo.mjs`): its words, its inks and the numbers its effects are laid out by.

const { BOLD, bg, fg } = run_board_theme_host_grid

interface Run {
	from: number
	count: number
	step?: number
}

// `count` numbers from `from`, `step` apart (1 when not given).
function run_of({ from, count, step = 1 }: Run): Array<number> {
	return Array.from({ length: count }, (_, index) => from + index * step)
}

// The listings' area rows are the demo's, whose area began on row 4; `area_rows_at` moves them under
// the live layout's area top (joshuafolkken/kit#8917), so an area past the frame takes them along.
const DEMO_AREA_TOP = 4

function area_rows_at(rows: ReadonlyArray<number>, area_top: number): Array<number> {
	return rows.map((y) => y - DEMO_AREA_TOP + area_top)
}

const MNEMONICS = [
	'LDA',
	'STA',
	'JSR',
	'BNE',
	'CMP',
	'LDX',
	'INX',
	'RTS',
	'AND',
	'ORA',
	'BEQ',
	'ADC',
]
const DATA_LABELS = ['RNG', 'AZM', 'ELV', 'VEL', 'TMP']
const MODES = ['SCAN MODE', 'ACQUIRING', 'TRACKING', 'LOCKING ON']
const DOTS = ['· · ·', ' · · ', '  ·  ']
const RESPONSES = [
	'RETRY THE GATE',
	'MERGE NOW',
	'PARK THE LANE',
	'ASK THE HUMAN',
	'REVERT AND REFILE',
]
// The response cursor walks down the list and back up, then settles on the second line.
const CURSOR_PATH = [...run_of({ from: 0, count: 5 }), ...run_of({ from: 3, count: 3, step: -1 })]
const HEX_DIGITS = '0123456789ABCDEF'
const SIGHT_CORES = '╋┼·'

const WHITE_RGB = '255;255;255'
const DARK_RGB = '70;0;0'
const ALARM_RGB = '200;40;40'
const WHITE = fg(WHITE_RGB)
const INK = `${WHITE}${BOLD}`
const PINK = fg('255;175;160')
const SOFT = fg('255;200;190')
const DIM_RED = fg('255;120;110')
const GAUGE_RGB = '255;150;140'
const GAUGE_RED = fg(GAUGE_RGB)
const SCAN_MARK = `${WHITE}${bg(ALARM_RGB)}`
const INVERSE = `${fg(DARK_RGB)}${BOLD}${bg(WHITE_RGB)}`
const ALARM = `${WHITE}${BOLD}${bg(ALARM_RGB)}`
const BOX = `${WHITE}${bg(DARK_RGB)}`
const BOX_TITLE = `${WHITE}${BOLD}${bg(DARK_RGB)}`
const FLASH = `${fg('120;0;0')}${BOLD}${bg(WHITE_RGB)}`
const BEAM_INK = fg('40;0;0')
const BEAM_TRAIL = [WHITE_RGB, '255;170;160', '220;90;90', '170;50;50']
const CROSS = `${fg('60;0;0')}${BOLD}${bg(GAUGE_RGB)}`

const INKS = {
	WHITE,
	INK,
	PINK,
	SOFT,
	DIM_RED,
	GAUGE_RED,
	SCAN_MARK,
	INVERSE,
	ALARM,
	BOX,
	BOX_TITLE,
	FLASH,
	BEAM_INK,
	CROSS,
}

// The listings: their rows and columns, their widths, their scroll paces and the panel's data column.
const LISTING = {
	rows: run_of({ from: 7, count: 5 }),
	area_rows: run_of({ from: 4, count: 8 }),
	threat_rows: run_of({ from: 5, count: 7 }),
	head_rows: run_of({ from: 0, count: 3 }),
	race_columns: run_of({ from: 40, count: 3, step: 25 }),
	side_columns: run_of({ from: 2, count: 2, step: 84 }),
	panel_w: 30,
	race_w: 23,
	side_w: 26,
	idle_pace: 8,
	notice_pace: 6,
	data_w: 12,
	data_seed: 60,
	data_head_seed: 61,
	data_scale: 10_000,
	data_digits: 4,
	data_hold: 20,
}

// A listing line's numbers: its salt, where a SCAN line falls, an address, a match, an operand.
const LINE = {
	salt: 5,
	scan_every: 9,
	word: 65_536,
	byte: 256,
	scan_step: 37,
	match_from: 60,
	match_span: 39.9,
	base: 0x2f_00,
	step: 3,
	half: 0.5,
	operand_salt: 2,
	byte_salt: 3,
	word_salt: 4,
	pick_salt: 1,
	wide: 4,
	narrow: 2,
}

// The blink every reticle and sight shares: lit four ticks in six.
const BLINK = { every: 6, lit: 4, alarm: 3, gauge_every: 4, gauge_lit: 2 }

const theme_colors: ThemeColors = {
	body: '255;215;205',
	rule: '210;70;70',
	ok: WHITE_RGB,
	red: '255;170;150',
	warn: '255;210;190',
	hi: WHITE_RGB,
	type: WHITE_RGB,
	notice: WHITE_RGB,
}

const theme_notes: Partial<Record<EventKey, string>> = {
	a: 'notice, progress, new lane, progress — every effect in turn',
	n: 'flash · a crosshair spans the screen · HUD and listings fill the area, more overflow into the header · POSSIBLE RESPONSE',
	p: 'reticle and beam on the line · the panel HUD engages, MATCH climbs · the listing races',
	r: 'target acquisition takes the area: brackets close on the lane number · three listings race',
	i: 'a scan band rolls down · a reticle hops lane to lane · the HUD rescans · the listing ticks',
}

const run_board_theme_skynet_data = {
	area_rows_at,
	WHITE_RGB,
	BEAM_TRAIL,
	BLINK,
	CURSOR_PATH,
	DATA_LABELS,
	DOTS,
	HEX_DIGITS,
	INKS,
	LINE,
	LISTING,
	MNEMONICS,
	MODES,
	RESPONSES,
	SIGHT_CORES,
	theme_colors,
	theme_notes,
}

export { run_board_theme_skynet_data }
export type { SkynetDraw }
