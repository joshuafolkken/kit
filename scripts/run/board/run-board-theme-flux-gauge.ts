import { run_board_theme_flux_data, type Rgb } from './run-board-theme-flux-data'
import { run_board_theme_flux_paint } from './run-board-theme-flux-paint'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'

// The BTTF theme's lamp gauge (joshuafolkken/kit#8917, run-board-flux-gauge.ts): ten columns of
// braille lamps right of the flux capacitor, green, amber and the red lamp, the heights stepping with
// the speed's range and springing past each change. Ported from `fixed-v21-theme-bttf.mjs`.

const { AMBER_ROWS, BANDS, BODY, GEOMETRY, LED_COLUMNS, WHITE, numbers_of } =
	run_board_theme_flux_data
const { mix, scaled } = run_board_theme_flux_paint
const { hash } = run_board_theme_host_hash

const BRAILLE = 0x28_00
const TOP_PAIR = 0x09
const UPPER_PAIRS = 3
const PAIR_STEP = 2
const BOTTOM_PAIR = 0xc0
const SPRING = numbers_of('1 2 2 1 -1 0')
const FLOOD_WHITE = 0.08
const BLINK_TICKS = 2
const BLINK_PHASES = 2
const CURRENT_GREEN_ROWS = 12
const CLIMBED_GREEN = '12 9 0 9 0 10 9 0 12 9'
const NO_AMBER = '0 0 0 0 0 0 0 0 0 0'
const BASE_RANGES = [
	{ below: 45, green: '9 9 0 9 0 9 9 0 9 9', amber: NO_AMBER, red: '' },
	{ below: 60, green: '10 9 0 9 0 11 9 0 12 9', amber: '0 0 0 0 0 0 0 0 1 0', red: '' },
	{ below: 75, green: CLIMBED_GREEN, amber: '2 0 0 0 0 0 0 3 5 1', red: '' },
	{ below: 87.5, green: CLIMBED_GREEN, amber: '5 2 0 0 0 0 0 4 6 3', red: '' },
	{
		below: Infinity,
		green: '12 12 12 12 12 12 12 12 11 12',
		amber: '6 3 6 6 6 6 6 6 0 6',
		red: '1 1 1 1 1 1 1 1 0 1',
	},
]
const TOP_RANGE = BASE_RANGES.length - 1
const ADDED = GEOMETRY.green_rows - CURRENT_GREEN_ROWS

interface Range {
	below: number
	green: Array<number>
	amber: Array<number>
	red: Array<number>
}

const RANGES: ReadonlyArray<Range> = BASE_RANGES.map((range) => ({
	below: range.below,
	green: numbers_of(range.green).map((height) => (height > 0 ? height + ADDED : 0)),
	amber: numbers_of(range.amber),
	red: range.red === '' ? [] : numbers_of(range.red),
}))
const [FIRST_RANGE = { below: 0, green: [], amber: [], red: [] }] = RANGES

// One braille dot pair of a gauge cell: the gauge row it shows and its bits.
interface Slot {
	row: number
	bit: number
}

function slots_of(cell: string): Array<Slot> {
	return cell
		.split(' ')
		.map((mark, index) => ({
			row: Number(mark),
			bit: index < UPPER_PAIRS ? TOP_PAIR * PAIR_STEP ** index : BOTTOM_PAIR,
			is_slot: mark !== '-',
		}))
		.filter((slot) => slot.is_slot)
		.map(({ row, bit }) => ({ row, bit }))
}

const SLOTS = GEOMETRY.slots.map((cell) => slots_of(cell))

// Idle touch: while the board holds still a lamp hops along the gauge — every 8 ticks one column,
// picked afresh, lights one lamp over its green bar for 3 ticks.
const CHASE_EVERY = 8
const CHASE_ON = 3
const CHASE_SALT = 77

type RangeAt = (tick: number) => number

interface Change {
	before: number
	since: number
}

// The gauge's look during a jump: the ticks its climb takes, and whether the capacitor floods.
interface GaugeLook {
	climb?: number
	is_flooded?: boolean
}

interface Moment {
	range: number
	change: Change | undefined
	climb: number | undefined
	is_blink: boolean
}

interface Bars {
	green: number
	amber: number
	is_red: boolean
}

// A cell of the figure: where it is, its character, and its colors.
interface FigureCell {
	row: number
	column: number
	text: string
	fg?: Rgb
	bg?: Rgb | undefined
}

interface Origin {
	row: number
	column: number
}

function range_of(speed: number): number {
	return RANGES.findIndex((range) => speed < range.below)
}

function change_before(tick: number, range_at: RangeAt, back: number): Change | undefined {
	const since = Array.from({ length: back }).findIndex(
		(_, ago) => range_at(tick - ago) !== range_at(tick - ago - 1),
	)

	if (since === -1) return undefined

	return { before: range_at(tick - since - 1), since }
}

function sprung(to: number, from: number, since: number | undefined, rows: number): number {
	if (since === undefined || to === from) return to
	const past = (SPRING[since] ?? 0) * Math.sign(to - from)

	return Math.min(rows, Math.max(0, to + past))
}

type Height = (to: number, from: number, rows: number) => number

function height_of(moment: Moment): Height {
	const { change, climb } = moment

	if (change === undefined || climb === undefined || moment.range !== TOP_RANGE) {
		return (to, from, rows) => sprung(to, from, change?.since, rows)
	}

	return (to, from) => Math.round(from + (to - from) * Math.min(1, (change.since + 1) / climb))
}

// A gauge's move: the range it shows, the one it comes from, and how a height grows between them.
interface Step {
	moment: Moment
	range: Range
	from: Range
	height: Height
}

function green_of(step: Step, column: number): number {
	const green = step.range.green[column] ?? 0
	const grown = step.height(green, step.from.green[column] ?? green, GEOMETRY.green_rows)
	const blink = step.moment.is_blink ? 1 : 0

	return grown === GEOMETRY.green_rows ? grown - blink : grown
}

function amber_of(step: Step, column: number): number {
	return step.height(step.range.amber[column] ?? 0, step.from.amber[column] ?? 0, AMBER_ROWS)
}

function bars_at(moment: Moment): Array<Bars> {
	const range = RANGES[moment.range] ?? FIRST_RANGE
	const from = RANGES[moment.change?.before ?? moment.range] ?? FIRST_RANGE
	const step = { moment, range, from, height: height_of(moment) }

	return range.green.map((_, column) => ({
		green: green_of(step, column),
		amber: amber_of(step, column),
		is_red: moment.change === undefined && range.red[column] === 1,
	}))
}

function is_lit(bars: Bars, row: number): boolean {
	if (row === 0) return bars.is_red
	const up = 1 + AMBER_ROWS + GEOMETRY.green_rows - 1 - row

	return up < bars.green || (up >= GEOMETRY.green_rows && up < GEOMETRY.green_rows + bars.amber)
}

function band_of(row: number): { color: Rgb; ground: number } {
	if (row === 0) return BANDS.red

	return row <= AMBER_ROWS ? BANDS.amber : BANDS.green
}

function led_cell(
	bars: Bars,
	slots: Array<Slot>,
	white: number,
): Omit<FigureCell, 'column' | 'row'> {
	const lit = slots.filter((slot) => is_lit(bars, slot.row))

	if (lit.length === 0) return { text: ' ', fg: BODY }
	const band = band_of(slots[0]?.row ?? 0)
	const bits = lit.reduce((sum, slot) => sum + slot.bit, 0)

	return {
		text: String.fromCodePoint(BRAILLE + bits),
		fg: mix(band.color, WHITE, white),
		bg: scaled(band.color, band.ground),
	}
}

function is_chase_held(moment: Moment, look: GaugeLook): boolean {
	return (
		look.climb !== undefined ||
		look.is_flooded === true ||
		moment.change !== undefined ||
		moment.range === TOP_RANGE
	)
}

function chased(bars: Array<Bars>, moment: Moment, look: GaugeLook, tick: number): Array<Bars> {
	if (is_chase_held(moment, look) || tick % CHASE_EVERY >= CHASE_ON) return bars
	const column = Math.floor(hash(Math.floor(tick / CHASE_EVERY), 0, CHASE_SALT) * LED_COLUMNS)

	return bars.map((bar, at) =>
		at === column && bar.green > 0
			? { ...bar, green: Math.min(GEOMETRY.green_rows, bar.green + 1) }
			: bar,
	)
}

function moment_of(tick: number, range_at: RangeAt, look: GaugeLook): Moment {
	const range = range_at(tick)
	const change = change_before(tick, range_at, Math.max(SPRING.length, look.climb ?? 0))
	const phase = Math.floor(tick / BLINK_TICKS) % BLINK_PHASES
	const is_blink = range === TOP_RANGE && change === undefined && phase === 1

	return { range, change, climb: look.climb, is_blink }
}

function gauge_cells(
	origin: Origin,
	tick: number,
	range_at: RangeAt,
	look: GaugeLook,
): Array<FigureCell> {
	const moment = moment_of(tick, range_at, look)
	const white = look.is_flooded ? FLOOD_WHITE : 0

	return chased(bars_at(moment), moment, look, tick).flatMap((bars, column) =>
		SLOTS.map((slots, cell) => ({
			row: origin.row + cell,
			column: origin.column + column,
			...led_cell(bars, slots, white),
		})),
	)
}

const run_board_theme_flux_gauge = {
	SPRING,
	TOP_RANGE,
	bars_at,
	change_before,
	gauge_cells,
	range_of,
	sprung,
}

export { run_board_theme_flux_gauge }
export type { FigureCell, GaugeLook, Origin }
