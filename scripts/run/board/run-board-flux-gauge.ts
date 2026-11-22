import type { TextColor } from './run-board-labels'
import type { PanelCell } from './run-board-panel-draw'
import { run_board_rgb, type Rgb } from './run-board-rgb'

// joshuafolkken/kit#8674: the bttf theme's lamp gauge — ten columns of nineteen lamps read off the
// film's cabin shots, a cell of braille holding four lamps of one column. Each column is a green bar from
// the bottom and an amber one from the thirteenth row, lit apart, under one red row; the board holds still
// inside a speed range and springs past its new height when the range changes.

const { parsed, scaled, shade_of } = run_board_rgb

const LED_COLUMNS = 10
const GREEN_ROWS = 12
const AMBER_ROWS = 6
// From the top: one red row, the amber ones, the green ones.
const LAMP_ROWS = 1 + AMBER_ROWS + GREEN_ROWS
const BRAILLE = 0x28_00
// A lamp is two dots across: dots 1 and 4 on a cell's top row, each row under it a bit higher, and dots
// 7 and 8 on its fourth.
const TOP_PAIR = 0x09
const UPPER_PAIRS = 3
const PAIR_STEP = 2
const BOTTOM_PAIR = 0xc0
const EMPTY = '-'

// A cell is four lamps of one column, top to bottom, each a lamp row from the top or none, and takes
// one color, so each cell holds one band only: the red row ends the first cell, the six amber rows fill
// the second and half the third, and the twelve green rows fill the last three — two lamps' height dark
// between the amber and the green, where the film has a dim row.
const LED_SLOTS = ['- - - 0', '1 2 3 4', '5 6 - -', '7 8 9 10', '11 12 13 14', '15 16 17 18']

// A column's lit lamps: the green bar's and the amber one's heights, and whether its red row is on.
interface Bars {
	green: number
	amber: number
	is_red: boolean
}

// A speed range, up to the speed `below`: every column's green and amber heights and red rows.
interface SpeedRange {
	below: number
	green: ReadonlyArray<number>
	amber: ReadonlyArray<number>
	red: ReadonlyArray<number>
}

function numbers_of(text: string): Array<number> {
	return text === '' ? [] : text.split(' ').map(Number)
}

// A lamp's dots in a cell, its place from the cell's top: each upper row's pair twice the one above.
function pair_bit(index: number): number {
	return index < UPPER_PAIRS ? TOP_PAIR * PAIR_STEP ** index : BOTTOM_PAIR
}

const SLOTS = LED_SLOTS.map((cell) =>
	cell
		.split(' ')
		.map((mark, index) => ({ row: Number(mark), bit: pair_bit(index), is_slot: mark !== EMPTY }))
		.filter((slot) => slot.is_slot),
)

const CLIMBED_GREEN = '12 9 0 9 0 10 9 0 12 9'

// Each range, with, in the top one, its red row. The lowest is the idle board: the third, the fifth and
// the eighth columns stay out.
const RANGES: ReadonlyArray<SpeedRange> = [
	{ below: 45, green: '9 9 0 9 0 9 9 0 9 9', amber: '0 0 0 0 0 0 0 0 0 0' },
	{ below: 60, green: '10 9 0 9 0 11 9 0 12 9', amber: '0 0 0 0 0 0 0 0 1 0' },
	{ below: 75, green: CLIMBED_GREEN, amber: '2 0 0 0 0 0 0 3 5 1' },
	{ below: 87.5, green: CLIMBED_GREEN, amber: '5 2 0 0 0 0 0 4 6 3' },
	{
		below: Infinity,
		green: '12 12 12 12 12 12 12 12 11 12',
		amber: '6 3 6 6 6 6 6 6 0 6',
		red: '1 1 1 1 1 1 1 1 0 1',
	},
].map((range) => ({
	below: range.below,
	green: numbers_of(range.green),
	amber: numbers_of(range.amber),
	red: numbers_of(range.red ?? ''),
}))
const [IDLE_RANGE = { below: Infinity, green: [], amber: [], red: [] }] = RANGES

// A change of range springs: how far past the new height a bar stands, by ticks since the change.
const SPRING = numbers_of('1 2 2 1 -1 0')

// Each band's color, and the share of it a lit cell stands on: 30%, the red's 25% to keep its dots at
// a contrast of 4.5 (VS Code repaints a foreground under that).
const BANDS = {
	red: { rgb: parsed('255;80;60'), named: 'red', ground: 0.25 },
	amber: { rgb: parsed('255;212;40'), named: 'yellow', ground: 0.3 },
	green: { rgb: parsed('50;235;90'), named: 'green', ground: 0.3 },
} as const satisfies Record<string, { rgb: Rgb; named: TextColor; ground: number }>

type Band = (typeof BANDS)[keyof typeof BANDS]

// The last range change within the spring's length before a tick: the range before it and the ticks
// since it.
interface RangeChange {
	before: number
	since: number
}

// What the board shows at a tick: its range and the change it is springing from.
interface GaugeMoment {
	range: number
	change: RangeChange | undefined
}

// The speed range a speed is in, the first whose `below` is over it.
function range_of(speed: number): number {
	return RANGES.findIndex((range) => speed < range.below)
}

function change_before(tick: number, range_at: (tick: number) => number): RangeChange | undefined {
	const since = SPRING.findIndex((_, back) => range_at(tick - back) !== range_at(tick - back - 1))

	if (since === -1) return undefined

	return { before: range_at(tick - since - 1), since }
}

// A bar's height `since` ticks after it changed `from` a height `to` one: past `to` by the spring, held
// on the board.
function sprung(to: number, from: number, since: number | undefined, rows: number): number {
	if (since === undefined || to === from) return to
	const past = (SPRING[since] ?? 0) * Math.sign(to - from)

	return Math.min(rows, Math.max(0, to + past))
}

// The range at an index, the lowest past either end.
function speed_range(index: number): SpeedRange {
	return RANGES[index] ?? IDLE_RANGE
}

// Every column's bar heights at a moment, sprung from the range before where it just changed; the red
// row lit once the board has settled.
function bars_at(moment: GaugeMoment): Array<Bars> {
	const range = speed_range(moment.range)
	const from = speed_range(moment.change?.before ?? moment.range)
	const since = moment.change?.since
	const is_settled = moment.change === undefined

	return range.green.map((green, column) => ({
		green: sprung(green, from.green[column] ?? green, since, GREEN_ROWS),
		amber: sprung(range.amber[column] ?? 0, from.amber[column] ?? 0, since, AMBER_ROWS),
		is_red: is_settled && range.red[column] === 1,
	}))
}

// Whether a lamp, a row from the top, is lit in a column.
function is_lit(bars: Bars, row: number): boolean {
	if (row === 0) return bars.is_red
	const up = LAMP_ROWS - 1 - row

	return up < bars.green || (up >= GREEN_ROWS && up < GREEN_ROWS + bars.amber)
}

function band_of(row: number): Band {
	if (row === 0) return BANDS.red

	return row <= AMBER_ROWS ? BANDS.amber : BANDS.green
}

// A cell's text and colors: its lit lamps' dots in their band's color on a share of it, or a blank —
// the board draws nothing where it is out.
function led_cell(bars: Bars, cell: number): Pick<PanelCell, 'text' | 'fg' | 'bg'> {
	const slots = SLOTS[cell] ?? []
	const lit = slots.filter((slot) => is_lit(bars, slot.row))

	if (lit.length === 0) return { text: ' ' }
	const band = band_of(slots[0]?.row ?? 0)
	const bits = lit.reduce((sum, slot) => sum + slot.bit, 0)

	return {
		text: String.fromCodePoint(BRAILLE + bits),
		fg: shade_of(band.rgb, band.named),
		bg: shade_of(scaled(band.rgb, band.ground), band.named),
	}
}

// The gauge's cells at a tick from its top left on screen, its range at each tick read from `range_at`.
function gauge_cells(
	origin: { row: number; column: number },
	tick: number,
	range_at: (tick: number) => number,
): Array<PanelCell> {
	const moment = { range: range_at(tick), change: change_before(tick, range_at) }

	return bars_at(moment).flatMap((bars, column) =>
		SLOTS.map((_, cell) => ({
			row: origin.row + cell,
			column: origin.column + column,
			...led_cell(bars, cell),
		})),
	)
}

const run_board_flux_gauge = {
	BANDS,
	LED_COLUMNS,
	bars_at,
	change_before,
	gauge_cells,
	range_of,
}

export { run_board_flux_gauge }
