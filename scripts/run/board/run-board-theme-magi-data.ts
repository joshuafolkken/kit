import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_sample } from './run-board-theme-host-sample'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, ThemeApi } from './run-board-theme-host-types'

// The MAGI theme's tables (joshuafolkken/kit#8917), ported from the confirmed theme demo
// (`fixed-v21-theme-demo.mjs`, theme 7): its inks, verdicts, bands, paces and the timings of its
// opening and ending.

const { BOLD, bg, fg } = run_board_theme_host_grid
const { NOTICE_ISSUE } = run_board_theme_host_sample
const { LINGER } = run_board_theme_host_state

// One panel of the three: its name in the frame's top, its place and width.
interface MagiPanel {
	name: string
	x: number
	y: number
	w: number
}

// How a panel looks: its status text, its frame's color as 'r;g;b' and the status's style.
interface PanelLook {
	text: string
	frame: string
	fill: string
}

// The theme built for one board: the host's helpers and the places the demo found from its layout.
interface MagiKit {
	api: ThemeApi
	panels: ReadonlyArray<MagiPanel>
	boot_panels: ReadonlyArray<MagiPanel>
	sync_end: number
	sync_w: number
	rows: MagiRows
}

// A blink: lit for the first `on` ticks of every `every`.
interface Beat {
	every: number
	on: number
}

// How the rule lights and the heartbeat run at each level of activity: cells a tick, lit cells,
// the light's color and its leading cell's, and the ticks between heartbeats.
interface Pace {
	speed: number
	length: number
	color: string
	head: string
	beat: number
}

const VERDICTS: ReadonlyArray<ReadonlyArray<number>> = [
	[1, 1, 0],
	[1, 1, 1],
	[1, 0, 1],
	[1, 1, 1],
]
const PANEL_NAMES = ['MELCHIOR·1', 'BALTHASAR·2', 'CASPER·3'] as const
const SIDE_W = 14
const ORANGE_ON = `${fg('30;10;0')}${BOLD}${bg('255;140;0')}`
const WHITE = '255;255;255'
const LIME = '120;255;150'
const RED_ON = `${fg(WHITE)}${BOLD}${bg('210;25;20')}`
const BODY = '255;150;30'
const PALE = '255;240;220'
const ORANGE = fg(BODY)
const GREEN = `${fg(LIME)}${BOLD}`
const AMBER = '255;190;60'
const AMBER_BOLD = `${fg(AMBER)}${BOLD}`
const RED_BOLD = `${fg('255;60;40')}${BOLD}`
const PALE_BOLD = `${fg(PALE)}${BOLD}`
const GREEN_ON = `${fg('10;30;10')}${BOLD}${bg(LIME)}`
const SPINNER = '|/-\\'

const BLINK = {
	slow: { every: 6, on: 3 },
	fast: { every: 4, on: 2 },
} satisfies Record<string, Beat>

// The board's own rows the demo draws on: the limit and sync rate's three, the links' and the low
// panels' first — the demo's, whose area starts on row 4; a board's are moved with its area
// (`rows_at`, joshuafolkken/kit#8917), so an area past the frame takes them with it.
const ROWS = { limit: 5, clock: 6, power: 7, links: 8, low: 9 }
const DEMO_AREA_TOP = 4

type MagiRows = typeof ROWS

function rows_at(area_top: number): MagiRows {
	const shift = area_top - DEMO_AREA_TOP

	return {
		limit: ROWS.limit + shift,
		clock: ROWS.clock + shift,
		power: ROWS.power + shift,
		links: ROWS.links + shift,
		low: ROWS.low + shift,
	}
}

// A PROGRESS or ROW effect is watched this long after it finishes; the verdicts stay this long.
const EFFECT_TICKS = 24
const VOTE_TICKS = 130
const EFFECT_TAIL = EFFECT_TICKS + LINGER
const VOTE_END = VOTE_TICKS + LINGER

const CHECKS = [
	{ name: 'A10 NERVE LINK', at: 30, word: 'CONNECTED' },
	{ name: 'HARMONICS', at: 60, word: 'NORMAL' },
	{ name: 'PLUG DEPTH', at: 90, word: 'STABLE' },
]

const STRIPES = '◢◤'

function cells_of(text: string, style: string): Array<Cell> {
	return Array.from(text, (ch): Cell => [ch, style])
}

const BAND: ReadonlyArray<Cell> = [
	...cells_of('◢◤◢◤◢◤◢◤', `${fg('255;40;30')}${BOLD}`),
	...cells_of(' WARNING ', ORANGE_ON),
	...cells_of('◢◤◢◤', `${fg('255;40;30')}${BOLD}`),
	...cells_of(' EMERGENCY ', RED_ON),
]

const EMERGENCY_LINES = [
	{ name: 'MAGI', value: 'ALERT DECLARED', ink: AMBER_BOLD },
	{ name: 'SOURCE', value: `${NOTICE_ISSUE} GATE RED`, ink: PALE_BOLD },
	{ name: 'CONDITION', value: 'RED · ALL UNITS HOLD', ink: RED_BOLD },
]

const PACES = {
	idle: { speed: 0.5, length: 3, color: '230;130;20', head: AMBER, beat: 200 },
	progress: { speed: 1.5, length: 7, color: '255;170;40', head: '255;225;140', beat: 100 },
	row: { speed: 3, length: 12, color: '255;200;80', head: '255;250;235', beat: 60 },
} satisfies Record<string, Pace>

// The opening's ticks: the title, the first panel, each next, ALL GREEN, the board unfolding, the
// bloom, the end of its drawing and its whole length.
const MAGI_OPEN = {
	title: 'MAGI SYSTEM START-UP',
	boot: 20,
	each: 14,
	green: 62,
	unfold: 84,
	bloom: 108,
	done: 110,
	ticks: 126,
}
const BOOT_W = 28
// The boot panels' places round the screen's middle: MELCHIOR right and low, BALTHASAR in the middle
// and high, CASPER left and low.
const BOOT_PLACES = { right: 3, middle: -14, left: -31, low: 1, high: -6 }
// The ending's ticks: the dim, the first panel off, each next, the collapse, the last line, the dark.
const MAGI_END = { dim: 4, off: 12, each: 12, collapse: 48, line: 72, gone: 80, ticks: 100 }

const COLORS = {
	body: BODY,
	rule: '140;70;0',
	ok: LIME,
	red: '255;50;40',
	warn: '255;210;0',
	hi: PALE,
	type: '255;235;200',
	notice: PALE,
	// The marks' tones: info, idle, waiting on a person.
	info: '255;190;90',
	idle: '170;95;15',
	human: '120;200;255',
}

const NOTES = {
	a: 'notice, progress, new lane, progress — every effect in turn',
	n: 'EMERGENCY in tall letters takes the area · the order and PATTERN BLUE overflow into the header · WARNING bands',
	p: 'the three deliberate while the line types · APPROVE / REJECT one by one · RESULT on the rule',
	r: 'the sync display takes the area: two waves fall into step, checks pass, the rate in tall digits',
	i: 'a pulse passes round the three panels · external power, clock stopped',
}

const run_board_theme_magi_data = {
	AMBER,
	AMBER_BOLD,
	BAND,
	BLINK,
	BOOT_PLACES,
	BOOT_W,
	CHECKS,
	COLORS,
	EFFECT_TAIL,
	EFFECT_TICKS,
	EMERGENCY_LINES,
	GREEN,
	GREEN_ON,
	MAGI_END,
	MAGI_OPEN,
	NOTES,
	ORANGE,
	ORANGE_ON,
	PACES,
	PALE,
	PALE_BOLD,
	PANEL_NAMES,
	RED_BOLD,
	RED_ON,
	SIDE_W,
	SPINNER,
	STRIPES,
	VERDICTS,
	VOTE_END,
	WHITE,
	rows_at,
}

export { run_board_theme_magi_data }
export type { Beat, MagiKit, MagiPanel, MagiRows, Pace, PanelLook }
