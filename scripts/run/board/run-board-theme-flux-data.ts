import type { EventKey, ThemeColors } from './run-board-theme-host-types'

// The BTTF theme's tables (joshuafolkken/kit#8917), the Back to the Future time circuits, ported from
// the confirmed theme demo (`fixed-v21-theme-bttf.mjs`): its colors, the flux capacitor's figure and
// the lamp gauge's slots. A color is an object so the table reads as plain data.

interface Rgb {
	r: number
	g: number
	b: number
}

// The colors (run-board-theme-defs.ts BTTF).
const DESTINATION: Rgb = { r: 255, g: 70, b: 50 }
const PRESENT: Rgb = { r: 70, g: 255, b: 110 }
const DEPARTED: Rgb = { r: 255, g: 190, b: 40 }
const BODY: Rgb = { r: 190, g: 198, b: 206 }
const RULE: Rgb = { r: 80, g: 88, b: 98 }
const HI: Rgb = { r: 235, g: 255, b: 252 }
const CIRCUITS: ReadonlyArray<Rgb> = [DESTINATION, PRESENT, DEPARTED]
const WHITE: Rgb = { r: 255, g: 255, b: 255 }
const BLACK: Rgb = { r: 0, g: 0, b: 0 }
const ARC: Rgb = { r: 150, g: 210, b: 255 }
const ICE: Rgb = { r: 190, g: 235, b: 255 }
const FLASH_BACK: Rgb = { r: 200, g: 230, b: 255 }
const SPEED_COLOR: Rgb = { r: 255, g: 175, b: 60 }
const DIM = 0.55
const DARK = 0.3
const COLON_TICKS = 10

const ROLES: ReadonlyMap<string, Rgb> = new Map([
	['body', BODY],
	['rule', RULE],
	['ok', PRESENT],
	['red', DESTINATION],
	['warn', DEPARTED],
	['hi', HI],
	['type', BODY],
	['notice', BODY],
])

// The flux capacitor's lamps and the gauge's lamps.
const FLUX: Rgb = { r: 255, g: 245, b: 200 }
const FLUX_GLOW: Rgb = { r: 120, g: 80, b: 30 }
const BAR_DARK: Rgb = { r: 70, g: 16, b: 24 }
const ORANGE: Rgb = { r: 230, g: 110, b: 60 }
const FLOOD: Rgb = { r: 108, g: 114, b: 124 }
const FLOOD_DIM: Rgb = { r: 78, g: 84, b: 96 }
const FLOOD_BAR: Rgb = { r: 250, g: 55, b: 70 }
const BANDS = {
	red: { color: { r: 255, g: 80, b: 60 }, ground: 0.25 },
	amber: { color: { r: 255, g: 212, b: 40 }, ground: 0.3 },
	green: { color: { r: 50, g: 235, b: 90 }, ground: 0.3 },
}

// The jump's flash: the wash's tints, and the fire trails' colors by age.
const TINTS: ReadonlyArray<Rgb> = [
	{ r: 159, g: 216, b: 238 },
	{ r: 120, g: 200, b: 255 },
	{ r: 150, g: 140, b: 235 },
	{ r: 190, g: 225, b: 255 },
	{ r: 60, g: 160, b: 240 },
]
const FIRE: ReadonlyArray<{ limit: number; color: Rgb }> = [
	{ limit: 4, color: { r: 255, g: 255, b: 235 } },
	{ limit: 22, color: { r: 255, g: 244, b: 165 } },
	{ limit: 34, color: { r: 205, g: 220, b: 255 } },
	{ limit: 47, color: { r: 95, g: 135, b: 255 } },
	{ limit: 58, color: { r: 35, g: 50, b: 150 } },
]
const EMBER: Rgb = { r: 255, g: 244, b: 165 }

// The seven-row figure (bttf-theme-demo.mjs PROPOSED): the panel's rows 5-11 exactly. A digit in
// `picture` is a lamp of that step; `slots` gives each gauge row's braille dots (a row of lamps each,
// '-' for none).
const GEOMETRY = {
	picture: [
		'0           0',
		'  1       1  ',
		'    2   2    ',
		'      3      ',
		'      2      ',
		'      1      ',
		'      0      ',
	],
	bar_row: 5,
	slots: ['- - - 0', '1 2 3 4', '5 6 - -', '7 8 9 10', '11 12 13 14', '15 16 17 18', '19 20 21 22'],
	green_rows: 16,
}
const LED_COLUMNS = 10
const AMBER_ROWS = 6

const NOTES: Partial<Record<EventKey, string>> = {
	a: 'notice, progress, new lane, progress — every effect in turn',
	i: 'the capacitor runs in, a strong round and a spark every 3 s · a lamp hops along the gauge · a circuit is checked every 5 s',
	p: 'the line arrives cold: it flashes, sparks ahead of the cursor, letters thaw from ice · then glows once, a few embers die · speed 72',
	r: 'the lane arrives cold, the triple flash of its row coming back every 1.8 s, bolts over the area · speed climbs toward 88, no jump, falls back',
	n: 'JUMP: speed to 88, bolts over the screen, the circuits take the area · blue-white wash to white, fire trails, clocks roll, the board thaws',
}

function text_of(color: Rgb): string {
	return `${String(color.r)};${String(color.g)};${String(color.b)}`
}

const COLORS: ThemeColors = {
	body: text_of(BODY),
	rule: text_of(RULE),
	ok: text_of(PRESENT),
	red: text_of(DESTINATION),
	warn: text_of(DEPARTED),
	hi: text_of(HI),
	type: text_of(BODY),
	notice: text_of(BODY),
	// The marks' tones: info, idle, waiting on a person.
	info: '130;190;255',
	idle: '110;118;128',
	human: '255;130;190',
}

// Numbers written as one line of text, space-separated: a gauge's column heights.
function numbers_of(line: string): Array<number> {
	return line.split(' ').map(Number)
}

const run_board_theme_flux_data = {
	AMBER_ROWS,
	ARC,
	BANDS,
	BAR_DARK,
	BLACK,
	BODY,
	CIRCUITS,
	COLON_TICKS,
	COLORS,
	DARK,
	DESTINATION,
	DIM,
	EMBER,
	FIRE,
	FLASH_BACK,
	FLOOD,
	FLOOD_BAR,
	FLOOD_DIM,
	FLUX,
	FLUX_GLOW,
	GEOMETRY,
	ICE,
	LED_COLUMNS,
	NOTES,
	ORANGE,
	RULE,
	ROLES,
	SPEED_COLOR,
	TINTS,
	WHITE,
	numbers_of,
	text_of,
}

export { run_board_theme_flux_data }
export type { Rgb }
