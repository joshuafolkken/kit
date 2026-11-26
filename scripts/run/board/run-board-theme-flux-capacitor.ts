import { run_board_theme_flux_data, type Rgb } from './run-board-theme-flux-data'
import type { FigureCell, Origin } from './run-board-theme-flux-gauge'
import { run_board_theme_flux_paint } from './run-board-theme-flux-paint'

// The BTTF theme's flux capacitor (joshuafolkken/kit#8917, run-board-flux.ts): the three arms' lamps
// running in to the middle, the red bar under them, and through the jump the figure flooded white
// then grey. Ported from the confirmed theme demo's `fixed-v21-theme-bttf.mjs`.

const {
	ARC,
	BAR_DARK,
	BODY,
	FLOOD,
	FLOOD_BAR,
	FLOOD_DIM,
	FLUX,
	FLUX_GLOW,
	GEOMETRY,
	ORANGE,
	WHITE,
} = run_board_theme_flux_data
const { HEAD_BACK, mix, scaled } = run_board_theme_flux_paint

const GLOW_LIFT = 0.2
const LAST_STEP_LIGHT = 0.6
const FLUX_CYCLE_TICKS = 3
const LIT = '●'
const UNLIT = '∙'
const FLUX_PACES = [
	{ ticks: 4, light: 0.45 },
	{ ticks: 3, light: 0.6 },
	{ ticks: 2, light: 0.8 },
	{ ticks: 1, light: 1 },
	{ ticks: 1, light: 1 },
]
const [FIRST_PACE = { ticks: 1, light: 1 }] = FLUX_PACES
const BAR_HALF = 4
const STEM_COLUMN = 6
const BAR = '━'
const WHITE_TICKS = 3
const DIM_TICKS = 12
const PULSE_BAR = 0.45

// One lamp of the figure: its row and column in the picture, and the step of the run it lights on.
interface Lamp {
	row: number
	column: number
	step: number
}

const LAMPS: ReadonlyArray<Lamp> = GEOMETRY.picture.flatMap((line, row) =>
	[...line.matchAll(/\d/gu)].map((mark) => ({ row, column: mark.index, step: Number(mark[0]) })),
)

// Idle touch: every three seconds one round of the arms' light runs in at full strength with the
// red bar warming, and as it ends a small spark crackles on the never-lit middle lamp.
const PULSE_EVERY = 60
// The beat stays clearly visible at rest: the lit lamp is never under 0.8 of full (the demo's 0.45 at
// idle read as dark), with the strong round at full on top.
const STEADY_LIGHT = 0.8
const SPARK_TICKS = 2
const MIDDLE = LAMPS.find((lamp) => lamp.step === FLUX_CYCLE_TICKS) ?? {
	row: 0,
	column: 0,
	step: 0,
}

// The capacitor during the jump: the ticks it has been flooded (undefined before), and whether it
// glows orange just before.
interface FluxJump {
	flood: number | undefined
	is_orange: boolean
}

interface Pulse {
	is_pulse?: boolean
	is_spark?: boolean
}

interface LampLook {
	text: string
	color: Rgb
}

function pace_of(range: number): { ticks: number; light: number } {
	return FLUX_PACES[Math.min(Math.max(0, range), FLUX_PACES.length - 1)] ?? FIRST_PACE
}

function lamp_look(tick: number, step: number, range: number, is_pulse = false): LampLook {
	const pace = pace_of(range)
	const light = is_pulse ? 1 : Math.max(pace.light, STEADY_LIGHT)

	if (step !== Math.floor(tick / pace.ticks) % FLUX_CYCLE_TICKS) {
		return { text: UNLIT, color: scaled(FLUX_GLOW, pace.light + GLOW_LIFT) }
	}

	const share = step < FLUX_CYCLE_TICKS - 1 ? 1 : LAST_STEP_LIGHT

	return { text: LIT, color: scaled(FLUX, light * share) }
}

function pulse_of(tick: number, range: number): Pulse {
	const round = FLUX_CYCLE_TICKS * pace_of(range).ticks
	const phase = tick % PULSE_EVERY

	return { is_pulse: phase < round, is_spark: phase >= round && phase < round + SPARK_TICKS }
}

function spark_cells(origin: Origin, pulse: Pulse): Array<FigureCell> {
	if (!pulse.is_spark) return []
	const row = origin.row + MIDDLE.row
	const column = origin.column + MIDDLE.column

	return [
		{ row, column, text: LIT, fg: WHITE, bg: HEAD_BACK },
		{ row, column: column - 1, text: '╲', fg: ARC },
		{ row, column: column + 1, text: '╱', fg: ARC },
	]
}

function bar_cells(origin: Origin, color: Rgb, back?: Rgb): Array<FigureCell> {
	return Array.from({ length: BAR_HALF + BAR_HALF + 1 }, (_, index) => ({
		row: origin.row + GEOMETRY.bar_row,
		column: origin.column + STEM_COLUMN - BAR_HALF + index,
		text: BAR,
		fg: color,
		bg: back,
	}))
}

function flood_ground(flood: number): Rgb {
	if (flood < WHITE_TICKS) return WHITE

	return mix(FLOOD, FLOOD_DIM, Math.min(1, (flood - WHITE_TICKS) / DIM_TICKS))
}

function flood_box(origin: Origin, back: Rgb): Array<FigureCell> {
	const width = (GEOMETRY.picture[0] ?? '').length + 1 + 1

	return Array.from({ length: GEOMETRY.picture.length * width }, (_, index) => ({
		row: origin.row + Math.floor(index / width),
		column: origin.column - 1 + (index % width),
		text: ' ',
		fg: BODY,
		bg: back,
	}))
}

function flooded_cells(origin: Origin, flood: number): Array<FigureCell> {
	const is_white = flood < WHITE_TICKS
	const back = flood_ground(flood)
	const lamps = LAMPS.map((lamp) => ({
		row: origin.row + lamp.row,
		column: origin.column + lamp.column,
		text: is_white ? ' ' : LIT,
		fg: WHITE,
		bg: back,
	}))

	return [
		...flood_box(origin, back),
		...bar_cells(origin, is_white ? WHITE : FLOOD_BAR, back),
		...lamps,
	]
}

function lamp_cells(
	origin: Origin,
	tick: number,
	range: number,
	look: { jump: FluxJump | undefined; pulse: Pulse },
): Array<FigureCell> {
	return LAMPS.map((lamp) => {
		const shown = look.jump?.is_orange
			? { text: LIT, color: ORANGE }
			: lamp_look(tick, lamp.step, range, look.pulse.is_pulse)

		return {
			row: origin.row + lamp.row,
			column: origin.column + lamp.column,
			text: shown.text,
			fg: shown.color,
		}
	})
}

function flux_cells(
	origin: Origin,
	tick: number,
	range: number,
	jump: FluxJump | undefined,
): Array<FigureCell> {
	if (jump?.flood !== undefined) return flooded_cells(origin, jump.flood)
	const pulse = jump ? {} : pulse_of(tick, range)
	const lamps = lamp_cells(origin, tick, range, { jump, pulse })
	const bar = pulse.is_pulse ? mix(BAR_DARK, FLOOD_BAR, PULSE_BAR) : BAR_DARK

	return [...bar_cells(origin, bar), ...lamps, ...spark_cells(origin, pulse)]
}

const run_board_theme_flux_capacitor = {
	LAMPS,
	flood_ground,
	flux_cells,
	lamp_look,
	pulse_of,
}

export { run_board_theme_flux_capacitor }
export type { FluxJump }
