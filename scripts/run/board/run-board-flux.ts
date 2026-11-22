import type { PanelCell } from './run-board-panel-draw'
import { run_board_rgb, type Rgb } from './run-board-rgb'

// joshuafolkken/kit#8674: the bttf theme's flux capacitor at idle — round lamps in a Y over six rows,
// light running in from the three outer ends at once, and the red bar across the stem. The arrival and
// the jump light it otherwise (their own children of the epic).

const { parsed, scaled, shade_of } = run_board_rgb

const FLUX = parsed('255;245;200')
const FLUX_GLOW = parsed('120;80;30')
// The dim lamps glow this much over their range's light.
const GLOW_LIFT = 0.2
// The third step of the run is this much of the light.
const LAST_STEP_LIGHT = 0.6
const FLUX_CYCLE_TICKS = 3
const LIT = '●'
const DIM = '∙'

// The capacitor from its top left, a lamp drawn as its step — how far along its line it is, 0 the
// outer end: each arm three lamps running two columns in for a row down, the middle (step 3, never lit)
// on the fourth row, the stem two lamps under it.
const FLUX_PICTURE = [
	'0           0',
	'  1       1  ',
	'    2   2    ',
	'      3      ',
	'      1      ',
	'      0      ',
] as const
const FLUX_ROWS = FLUX_PICTURE.length
const FLUX_WIDTH = FLUX_PICTURE[0].length

// How long a step holds, in ticks, and how bright the light is, by speed range: slow and dim in the
// lowest, the film's pace in the highest.
const FLUX_PACES: ReadonlyArray<{ ticks: number; light: number }> = [
	{ ticks: 4, light: 0.45 },
	{ ticks: 3, light: 0.6 },
	{ ticks: 2, light: 0.8 },
	{ ticks: 1, light: 1 },
	{ ticks: 1, light: 1 },
]

// The red bar: always there on the fifth row, crossing the stem with the same length either side.
const BAR_ROW = 4
const BAR_HALF = 4
const BAR_LENGTH = BAR_HALF + 1 + BAR_HALF
const STEM_COLUMN = 6
const BAR_DARK = parsed('70;16;24')
const BAR = '━'

// The capacitor's top left on screen, 1-based.
interface FluxOrigin {
	row: number
	column: number
}

// A lamp on the picture: its row and column from the top left, and its step.
interface FluxLamp {
	row: number
	column: number
	step: number
}

type Pace = (typeof FLUX_PACES)[number]

const FLUX_LAMPS: ReadonlyArray<FluxLamp> = FLUX_PICTURE.flatMap((line, row) =>
	[...line.matchAll(/\d/gu)].map((mark) => ({ row, column: mark.index, step: Number(mark[0]) })),
)

function pace_of(range: number): Pace {
	return FLUX_PACES[Math.min(Math.max(0, range), FLUX_PACES.length - 1)] ?? { ticks: 1, light: 1 }
}

// A lamp's text and color at a tick: lit where the run is on its step, else a dim dot.
function lamp_look(tick: number, step: number, range: number): { text: string; rgb: Rgb } {
	const pace = pace_of(range)

	if (step !== Math.floor(tick / pace.ticks) % FLUX_CYCLE_TICKS) {
		return { text: DIM, rgb: scaled(FLUX_GLOW, pace.light + GLOW_LIFT) }
	}

	const share = step < FLUX_CYCLE_TICKS - 1 ? 1 : LAST_STEP_LIGHT

	return { text: LIT, rgb: scaled(FLUX, pace.light * share) }
}

function lamp_cells(origin: FluxOrigin, tick: number, range: number): Array<PanelCell> {
	return FLUX_LAMPS.map((lamp) => {
		const look = lamp_look(tick, lamp.step, range)

		return {
			row: origin.row + lamp.row,
			column: origin.column + lamp.column,
			text: look.text,
			fg: shade_of(look.rgb, look.text === LIT ? 'white' : 'gray'),
		}
	})
}

function bar_cells(origin: FluxOrigin): Array<PanelCell> {
	const fg = shade_of(BAR_DARK, 'red')

	return Array.from({ length: BAR_LENGTH }, (_, index) => ({
		row: origin.row + BAR_ROW,
		column: origin.column + STEM_COLUMN - BAR_HALF + index,
		text: BAR,
		fg,
	}))
}

// The capacitor's cells at a tick in a speed range: the bar first, the lamps over it.
function flux_cells(origin: FluxOrigin, tick: number, range: number): Array<PanelCell> {
	return [...bar_cells(origin), ...lamp_cells(origin, tick, range)]
}

const run_board_flux = { FLUX_LAMPS, FLUX_ROWS, FLUX_WIDTH, flux_cells, lamp_look }

export { run_board_flux }
export type { FluxOrigin }
