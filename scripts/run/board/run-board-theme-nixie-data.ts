import { run_board_theme_host_sample } from './run-board-theme-host-sample'
import type { Grid, ThemeApi, ThemeState } from './run-board-theme-host-types'

// STEINS;GATE's tables (joshuafolkken/kit#8917), ported from the confirmed theme demo: the world
// lines the divergence meter reads, its colors, and the shapes its effects draw with.

const { NOTICE_TEXT } = run_board_theme_host_sample

// What a STEINS;GATE effect draws with: the host's helpers, the grid, the state and the tick.
interface NixiePart {
	api: ThemeApi
	grid: Grid
	tick: number
}

interface NixieDraw extends NixiePart {
	state: ThemeState
}

// The anime's readings. α: the first D-mail's world line and the ones the later D-mails reach.
// β: the opening world line and the one the story returns to.
const ALPHA_LINES: ReadonlyArray<string> = [
	'0.571024',
	'0.571015',
	'0.523299',
	'0.456903',
	'0.409420',
	'0.337187',
]
const BETA_LINES: ReadonlyArray<string> = ['1.130426', '1.130205']
const FIRST_ALPHA = '0.571024'
const FIRST_BETA = '1.130426'
// Seven tubes of three cells, a one-cell point, and a blank between each.
const METER_DIGITS = FIRST_ALPHA.length
const IDLE_AFTER = 40
// A tube locks three ticks after the one before it.
const LOCK_STEP = 3
// A blink lights two ticks in four.
const BLINK = { every: 4, lit: 2 }

// A world line shift by the event that caused it: how hard, how long, and the ticks it flashes on
// (the first `flashes` multiples of `flash_every`).
interface Shift {
	power: number
	ticks: number
	flashes: number
	flash_every: number
}

const SHIFTS: Readonly<Record<string, Shift>> = {
	progress: { power: 0.5, ticks: 6, flashes: 0, flash_every: 1 },
	row: { power: 1, ticks: 10, flashes: 1, flash_every: 1 },
	notice: { power: 1.6, ticks: 26, flashes: 3, flash_every: 3 },
}

const COLOR = {
	spin: '255;200;120',
	landed: '255;235;190',
	amber: '255;150;40',
	white: '255;255;255',
	swell: '255;205;130',
	dim: '120;55;15',
	ghost: '75;30;8',
	label: '255;240;210',
	spun: '255;210;140',
	spark: '255;240;200',
	bolt: '170;215;255',
	mail_dark: '8;16;30',
	mail_label: '20;30;50',
	flash_ink: '40;10;0',
	flash_paper: '255;190;110',
	settling: '150;70;20',
	misread: '255;225;170',
	giant_ghost: '70;28;8',
	giant_lit: '255;245;225',
	giant_warm: '255;170;60',
	ember_dark: '25;10;3',
	ember_lit: '150;60;15',
	cold: '20;8;2',
	dust: '255;220;160',
}
const SPRAY: ReadonlyArray<string> = ['255;120;30', COLOR.dust, '180;60;10']
const SPRAY_GLYPHS = '0123456789█▓▒░'

const MAIL_W = 34
const MAIL_BYTES = 36
const MAIL_LINE = 12
// The notice's text: its time, icon and cue, the separator, then what it says.
const NOTICE_PARTS = 2
// What the mail says: the notice after its time, icon and cue, cut to a D-mail's bytes.
const MAIL_BODY = (NOTICE_TEXT.split(' · ', NOTICE_PARTS)[1] ?? '')
	.slice(0, MAIL_BYTES)
	.padEnd(MAIL_BYTES)

// The NOTICE's giant meter: the seven-segment bars each digit 0-9 lights (a letter a bar), and
// where it starts.
const SEGMENTS: ReadonlyArray<string> = [
	'a b c d e f',
	'b c',
	'a b g e d',
	'a b g c d',
	'f g b c',
	'a f g c d',
	'a f g e d c',
	'a b c',
	'a b c d e f g',
	'a b f g c d',
]
const GIANT_FROM = 0.45
const GIANT_X = 17
// A tube of the giant meter is 9 cells by 8, and the next one starts two cells after it.
const GIANT = { w: 9, h: 8, mid: 4, left: 1, right: 7, step: 11, point_step: 4 }

// The item `index` of a cycled list.
function nth(list: ReadonlyArray<string>, index: number): string {
	return list[index % list.length] ?? ''
}

const run_board_theme_nixie_data = {
	ALPHA_LINES,
	BETA_LINES,
	BLINK,
	COLOR,
	FIRST_ALPHA,
	FIRST_BETA,
	GIANT,
	GIANT_FROM,
	GIANT_X,
	IDLE_AFTER,
	LOCK_STEP,
	MAIL_BODY,
	MAIL_BYTES,
	MAIL_LINE,
	MAIL_W,
	METER_DIGITS,
	SEGMENTS,
	SHIFTS,
	SPRAY,
	SPRAY_GLYPHS,
	nth,
}

export { run_board_theme_nixie_data }
export type { NixieDraw, NixiePart, Shift }
