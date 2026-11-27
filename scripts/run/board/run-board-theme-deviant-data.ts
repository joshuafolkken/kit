import type { EventKey, ThemeColors } from './run-board-theme-host-types'

// The deviant theme's tables: the Detroit screens' colors — those marked "measured" were read from
// frame pixels — and the places, paces and odds of each part, as the confirmed design draws them.

const RGB = {
	white: '255;255;255',
	text: '207;224;234',
	// measured: the unselected name plate
	soft: '137;165;189',
	// measured: the menu cursor plate
	steel: '64;99;121',
	// measured: the selected chapter plate
	plate: '37;71;99',
	// measured: the chip of a stamped fact
	blue: '27;152;242',
	cyan: '110;205;255',
	// measured: the lit part of the analysis bar
	red: '253;15;12',
	// measured: the unlit part of the analysis bar
	track: '77;27;26',
	order: '255;84;48',
	// measured: the ticks of the reconstruction timeline
	yellow: '227;202;75',
	// measured: the dark of the rooftop scene
	night: '9;13;22',
	grey: '128;134;142',
	ink: '22;34;50',
	wall_dark: '58;6;6',
	wall_bright: '150;22;12',
	wash: '52;6;8',
	// The dark scan blue the board sinks into through a reconstruction.
	deep: '40;62;80',
	ice_dim: '196;222;236',
	ice_bright: '246;251;254',
}

// The panel: the rows the design lays it out on, where its parts' rows start, and how far the thin
// weight of a two-weight line is taken to the night.
const PANEL = { rows: 7, body: 2, thin: 0.45 }

// A plate's label sits a cell in from its bracket; the far bracket follows the label's padding.
const PLATE = { pad: 3 }

// The waiting ring: its glyphs and the ticks each shows.
const RING = { glyphs: '◜◝◞◟', pace: 3 }

// The ornament line under the model line: a cross where the line is long enough for one.
const ORNAMENT = { min: 16, cross: 0.62 }

// The date card: the gap after its date, the half-day's width with its gap, and "all of it".
const CARD = { gap: 2, half: 3, whole: 99, noon: 12, digits: 2, row: 1 }
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
// The days whose ordinal is not TH.
const ORDINALS: ReadonlyMap<string, string> = new Map([
	['1', 'ST'],
	['2', 'ND'],
	['3', 'RD'],
	['21', 'ST'],
	['22', 'ND'],
	['23', 'RD'],
	['31', 'ST'],
])

// The triangle: a lit left face and a darker right face, breathing as an LED does.
const TRIANGLE = ['   ▟▙   ', '  ▟██▙  ', ' ▟████▙ ', '▟██████▙']
const FACE = { lit: 0.25, lit_glow: 0.2, dark: 0.35, dark_glow: 0.15, breath: 9, back: 10 }

// The model line: its two weights, the mark a NOTICE leaves and where each sits.
const MODEL = {
	x: 3,
	name: 'RK800',
	kind: 'ANDROID',
	mark: 'SOFTWARE INSTABILITY ▲',
	mark_back: 24,
	blink: 6,
	blink_lit: 3,
	brand: 'CYBERLIFE',
	brand_back: 10,
	board: 'josh-detroit',
}

// IDLE: the choice list and its cursor, which holds a line, then fades to the next.
const CHOICES: ReadonlyArray<readonly [string, string]> = [
	['△', 'CONTINUE'],
	['□', 'ANALYZE'],
	['○', 'RECONSTRUCT'],
	['✕', 'STAND BY'],
]
const CURSOR = { hold: 70, fade: 10, sign_x: 3, plate_x: 2, end_x: 18, label_w: 12 }

// IDLE's one screen-wide effect: a faint blue band passes down the board, a second in every eight.
const SCAN = { every: 160, ticks: 20, reach: 3, tint: 0.14 }

// The analysis bar and the timeline are as wide as the panel lets them be.
const BAR = { min: 8, max: 34, margin: 12 }

// PROGRESS: the clue analysis — the reticle, the readout beside it, the tally and how long it lingers.
const ANALYSIS = {
	tail: 30,
	hold: 'HOLD △ TO ANALYZE',
	hold_back: 19,
	reticle_x: 8,
	open: 5,
	close: 3,
	beat: 4,
	beat_on: 2,
	readout_x: 18,
	percent: 100,
	percent_w: 3,
	rule_w: 16,
	tally_x: 3,
	tally_gap: 4,
	tally: 'CLUES TO ANALYZE',
}

// PROGRESS on the board: its text eases to grey-blue while the line types, and small reticle
// brackets hop over the data.
const SCAN_MODE = {
	ease_in: 8,
	ease_out: 12,
	dim: 0.55,
	header_rows: 3,
	brackets: 3,
	hop: 12,
	span: 4,
	margin: 6,
	salt_x: 61,
	salt_y: 62,
}

// ROW: the stamped fact wiped in two letters a tick, and the reconstruction timeline across the area.
const STAMP = {
	tail: 30,
	pace: 2,
	chip_x: 1,
	text_x: 3,
	lead: 'A NEW LANE',
	bold: 'JOINED',
	bold_after: 10,
	thin: 'THE RUN',
	thin_x: 10,
	thin_after: 16,
	rule_after: 8,
	rule_w: 16,
	chip_back: 2,
	blink: 8,
	blink_lit: 4,
	open: 'RECONSTRUCT INCOMPLETE',
	closed: 'RECONSTRUCT COMPLETE',
	// The head rewinds for this long before it plays; the board sinks and rises over `ease` ticks;
	// every rule flashes for `flash` ticks as the lane has typed.
	rewind: 12,
	ease: 6,
	flash: 4,
	hint: '◀◀ REWIND',
	outline: 0.5,
	prompt_beat: 8,
	prompt_lit: 4,
	prompt_glow: 0.25,
}
const TIMELINE = { box_w: 4, track_x: 6, min: 8, ticks: 9, tail: 2, unlit: 0.6 }

// NOTICE: the red wall of orders — its hits, its squares and grid, the order text and the key prompts.
// The wall starts a second into the notice, after the order's prompt, and builds for three; its
// hits, cracks and later parts are timed in ticks of that build. The hits keep the measured rhythm —
// a triple tap, a pause, a single, a pause, four quickening — all in the build's first half; the
// rest is held still until the shatter (`run-board-sound-palettes-deviant.ts` → `CALL` sounds them).
const HITS = { tap: 2, tap_two: 5, tap_three: 8, single: 14, run: 20, run_two: 24, run_three: 27 }
const LAST_HIT = 29
const WALL = {
	from: 20,
	build: 60,
	drain: 40,
	drain_over: 1.2,
	drain_edge: 6,
	hits: [...Object.values(HITS), LAST_HIT],
	hit_ticks: 2,
	hit_glyphs: '▓▒░ ',
	hit_dark: 0.45,
	hit_sway: 0.3,
	hit_salt: 5,
	fill: 0.6,
	thin: 0.55,
	block_salt: 3,
	ground_salt: 9,
	grid_x: 12,
	grid_y: 3,
	grid_line: 2,
	grid_dark: 0.72,
	header_from: 30,
	header_ticks: 30,
	header_rows: 3,
	center: 0.42,
	center_row: 4,
	wash: 1.6,
	flash: 0.6,
	flash_ink: 0.3,
}
// PROGRESS on the rules: a blue light runs out to the rule's end once the line has typed, then the
// rule eases back to its own color.
const RULES = { run: 12, glint: 6, ease: 18, glow: 0.6, lead: 8 }
// A rule row on the normal display: its mark's cells, the cells in a row its line first runs for, and
// how far a column's label is taken from the soft color to the night.
const RULE_ROW = { mark: 2, run: 3, label_dim: 0.3 }

// IDLE's one-point effect: every three seconds a small reticle closes on one of the board's
// numbers, holds a second and lets go.
const WATCH = {
	every: 60,
	close: 10,
	hold: 20,
	open: 6,
	gap: 5,
	reach: 4,
	top: 3,
	where_salt: 92,
}

// The level the rule's right end reads: the board's real level as stress, a NOTICE's own climb.
const STRESS = { calm: 5, step: 20, base: 10, full: 99 }

// OPENING: the date card on black, the ice-white menu, the light bars lifting off the board.
const OPEN = {
	// The card's letters as the opening's sound counts them, two a tick.
	line: 'NOV 27TH  AM 11:17',
	letter_ms: 25,
	per_tick: 2,
	card_x: 2,
	card_up: 3,
	ring_back: 4,
	menu_from: 22,
	ice_ticks: 8,
	// The chapter card: the menu slides away, the card fades in and holds until the bars lift.
	chapter_from: 60,
	slide: 6,
	card_fade: 6,
	card_row: 2,
	reveal_from: 90,
	reveal_ticks: 44,
	bar_w: 8,
	bar_salt: 5,
}
const MENU = {
	labels: ['CONTINUE', 'NEW STORY', 'CHAPTERS', 'OPTIONS', 'EXTRAS'],
	top: 0.22,
	triangle_back: 4,
	title: 'D E T R O I T',
	title_row: 5,
	title_back: 6,
	sub: 'B E C O M E   H U M A N',
	sub_row: 6,
	sub_back: 11,
	row: 10,
	left: 34,
	margin: 2,
	label_x: 4,
	label_step: 14,
	plate_end: 15,
	bar_w: 13,
	pulse_after: 30,
	pulse_beat: 4,
	pulse_lit: 2,
}
const REVEAL = { lead: 4, spread: 26, rise: 0.2, rise_max: 11, flash: 2, column: 4, salt: 7 }

// ENDING: the mission stamp over the grey board, the wipe in columns, a second of empty screen.
const CLOSE = {
	stamp_ticks: 36,
	wipe_ticks: 30,
	empty_ticks: 20,
	grey: 0.3,
	row: 3,
	up: 3,
	back: 12,
	pace: 2,
	box_x: 2,
	box_w: 30,
	word: 'MISSION',
	rest: 'SUCCESSFUL',
	rest_x: 8,
	rest_after: 8,
	rule_after: 6,
	rule_w: 18,
	odds: 'PROBABILITY OF SUCCESS',
	odds_after: 18,
	full: '100%',
	full_x: 23,
	full_after: 44,
	column: 4,
	salt: 3,
	spread: 20,
	rise: 0.15,
}

const theme_colors: ThemeColors = {
	body: RGB.text,
	rule: RGB.steel,
	ok: RGB.cyan,
	red: RGB.red,
	warn: RGB.yellow,
	hi: RGB.white,
	type: RGB.white,
	notice: RGB.order,
	// The marks' tones: info, idle, waiting on a person.
	info: RGB.soft,
	idle: '90;115;140',
	human: '255;190;150',
}

const theme_notes: Partial<Record<EventKey, string>> = {
	a: 'notice, progress, new lane, progress — every effect in turn',
	i: 'the choice list △ □ ○ ✕, its plate fading from line to line · the triangle breathes · date card · waiting ring · a faint scan band',
	p: 'clue analysis: the reticle closes, SYNC % counts, the red bar grows and turns blue — RECONSTRUCT · the board dims to scan mode',
	r: 'a fact is stamped in two weights beside a blue chip · the reconstruction timeline scrubs past its yellow ticks across the area',
	n: 'the board freezes grey · the red wall of orders grows from the left, cracks under each hit and shatters · SOFTWARE INSTABILITY',
}

const run_board_theme_deviant_data = {
	ANALYSIS,
	BAR,
	CARD,
	CHOICES,
	CLOSE,
	CURSOR,
	FACE,
	MENU,
	MODEL,
	MONTHS,
	OPEN,
	ORDINALS,
	ORNAMENT,
	PANEL,
	PLATE,
	REVEAL,
	RGB,
	RING,
	RULES,
	RULE_ROW,
	SCAN,
	SCAN_MODE,
	STAMP,
	STRESS,
	TIMELINE,
	TRIANGLE,
	WALL,
	WATCH,
	theme_colors,
	theme_notes,
}

export { run_board_theme_deviant_data }
