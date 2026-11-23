import type { Paint } from './run-board-labels'
import type { PanelCell } from './run-board-panel-draw'
import { run_board_rgb, type Rgb } from './run-board-rgb'

// joshuafolkken/kit#8674: the bttf theme's flux capacitor at idle — round lamps in a Y over seven rows,
// light running in from the three outer ends at once, and the red bar across the stem. The arrival and
// the jump light it otherwise (their own children of the epic).

const { mixed, parsed, scaled, shade_of } = run_board_rgb

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
// on the fourth row, the stem three lamps under it, lit one at a time from its bottom as each arm
// (joshuafolkken/kit#8712).
const FLUX_PICTURE = [
	'0           0',
	'  1       1  ',
	'    2   2    ',
	'      3      ',
	'      2      ',
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

// The red bar: always there on the sixth row, across the stem's middle lamp with the same length either
// side.
const BAR_ROW = 5
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

function bar_cells(
	origin: FluxOrigin,
	fg: Paint = shade_of(BAR_DARK, 'red'),
	bg?: Paint,
): Array<PanelCell> {
	return Array.from({ length: BAR_LENGTH }, (_, index) => ({
		row: origin.row + BAR_ROW,
		column: origin.column + STEM_COLUMN - BAR_HALF + index,
		text: BAR,
		fg,
		bg,
	}))
}

// joshuafolkken/kit#8677: through a jump the capacitor floods — the two ticks before, every lamp is
// orange; from its first tick the box stands on a gray darkening over `DIM_TICKS`, every lamp a white
// dot and the bar red — never a white box (joshuafolkken/kit#8739). The gray is as light as a white dot
// keeps a contrast of 4.5 on (VS Code repaints a foreground under that).
interface FluxFlood {
	// The ticks since the flood began, none outside it.
	flood?: number | undefined
	is_orange: boolean
}

const WHITE = parsed('255;255;255')
const ORANGE = parsed('230;110;60')
const FLOOD = parsed('108;114;124')
const FLOOD_DIM = parsed('78;84;96')
const FLOOD_BAR = parsed('250;55;70')
const DIM_TICKS = 12

function flood_ground(flood: number): Rgb {
	return mixed(FLOOD, FLOOD_DIM, Math.min(1, flood / DIM_TICKS))
}

// The box: every cell of the capacitor's rows, a column past it either side, blank on the ground.
function box_cells(origin: FluxOrigin, bg: Paint): Array<PanelCell> {
	const width = 1 + FLUX_WIDTH + 1

	return Array.from({ length: FLUX_ROWS * width }, (_, index) => ({
		row: origin.row + Math.floor(index / width),
		column: origin.column - 1 + (index % width),
		text: ' ',
		bg,
	}))
}

// The flooded capacitor `flood` ticks in: the box, the bar and the lamps on its ground.
function flooded_cells(origin: FluxOrigin, flood: number): Array<PanelCell> {
	const bg = shade_of(flood_ground(flood), 'white')
	const bar = shade_of(FLOOD_BAR, 'red')
	const lamps = FLUX_LAMPS.map((lamp) => ({
		row: origin.row + lamp.row,
		column: origin.column + lamp.column,
		text: LIT,
		fg: shade_of(WHITE, 'white'),
		bg,
	}))

	return [...box_cells(origin, bg), ...bar_cells(origin, bar, bg), ...lamps]
}

// Every lamp lit orange, the two ticks before the flood.
function orange_cells(origin: FluxOrigin): Array<PanelCell> {
	const fg = shade_of(ORANGE, 'yellow')

	return FLUX_LAMPS.map((lamp) => ({
		row: origin.row + lamp.row,
		column: origin.column + lamp.column,
		text: LIT,
		fg,
	}))
}

// The capacitor's cells at a tick in a speed range: the bar first, the lamps over it; through a jump,
// orange before the flood and flooded through it.
function flux_cells(
	origin: FluxOrigin,
	tick: number,
	range: number,
	jump?: FluxFlood,
): Array<PanelCell> {
	if (jump?.flood !== undefined) return flooded_cells(origin, jump.flood)
	if (jump?.is_orange === true) return [...bar_cells(origin), ...orange_cells(origin)]

	return [...bar_cells(origin), ...lamp_cells(origin, tick, range)]
}

const run_board_flux = {
	FLOOD,
	FLOOD_DIM,
	FLUX_LAMPS,
	FLUX_ROWS,
	FLUX_WIDTH,
	flux_cells,
	lamp_look,
}

export { run_board_flux }
export type { FluxFlood, FluxOrigin }
