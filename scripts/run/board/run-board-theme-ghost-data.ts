import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { EventKey, ThemeColors } from './run-board-theme-host-types'

// The ghost theme's tables: a net dive — cyan and white with a little orange, a ring of text
// traveling round an ellipse, a net graph of nodes and links, noise that resolves into text. Nothing
// falls in columns. Its words are generic, its look is color and motion alone.

const { BOLD, bg, fg } = run_board_theme_host_grid

const RGB = {
	cyan: '0;200;255',
	pale: '180;240;255',
	dim: '0;70;100',
	rule: '0;120;160',
	orange: '255;140;40',
	white: '255;255;255',
	deep: '0;30;45',
}

const INKS = {
	CYAN: fg(RGB.cyan),
	PALE: fg(RGB.pale),
	DIM: fg(RGB.dim),
	ORANGE: `${fg(RGB.orange)}${BOLD}`,
	WHITE: `${fg(RGB.white)}${BOLD}`,
	BAR: `${fg(RGB.deep)}${BOLD}${bg(RGB.cyan)}`,
	FLASH: `${fg(RGB.deep)}${BOLD}${bg(RGB.white)}`,
}

const HEX_DIGITS = '0123456789ABCDEF'

// The panel's status block: its rows, the barrier gauge and the sync reading's drift, in tenths.
const STATUS = {
	link_row: 0,
	barrier_row: 1,
	sync_row: 2,
	value_x: 8,
	barrier_cells: 4,
	barrier_lit: 3,
	sync: 982,
	sync_drift: 6,
	sync_hold: 30,
	sync_salt: 71,
	tenth: 10,
}

// The ring of text: its centre and radii in the panel, its words, how many letters a column of
// radius carries, and its turns a tick at rest and while anything types.
const RING = {
	x: 29,
	y: 2.5,
	radius: { x: 9, y: 2.5 },
	text: 'NET·LINK·SYNC·DIVE·',
	density: 2,
	idle_pace: 0.004,
	busy_pace: 0.02,
}

// The small net graph inside the ring: its rows, its nodes and the pace its pulse hops them at.
const GRAPH = {
	x: 26,
	y: 2,
	rows: ['◦──◦──◦', '   │   ', ' ◦─┴─◦ '],
	nodes: [
		{ x: 0, y: 0 },
		{ x: 3, y: 0 },
		{ x: 6, y: 0 },
		{ x: 5, y: 2 },
		{ x: 1, y: 2 },
	],
	hop: 12,
}

// The camouflage ripple: a small patch shifts a column and dims for a few ticks, every few seconds.
const RIPPLE = { every: 80, ticks: 6, w: 8, h: 3, salt: 72 }

// PROGRESS: the rectangles zooming to the ring's centre, the hex pairs streaming under the status.
const DIVE = {
	rects: 3,
	pace: 0.05,
	half_x: 7,
	near: 0.5,
	stream_row: 4,
	streams: 2,
	stream_w: 17,
	pair: 3,
	salt: 73,
	linger: 8,
}

// The big net graph's nodes, each as shares of its pane's width and height.
const NET_NODES = {
	west: { x: 0.06, y: 0.2 },
	south: { x: 0.28, y: 0.8 },
	north: { x: 0.44, y: 0.1 },
	east: { x: 0.62, y: 0.7 },
}

// ROW: the noise a lane decloaks out of, the big net graph over the data and its new node.
const CLOAK = {
	glyphs: '░▒·:░',
	hold: 2,
	salt: 74,
	nodes: NET_NODES,
	links: [
		{ from: NET_NODES.west, to: NET_NODES.south },
		{ from: NET_NODES.west, to: NET_NODES.north },
		{ from: NET_NODES.south, to: NET_NODES.east },
		{ from: NET_NODES.north, to: NET_NODES.east },
	],
	new_link: { from: NET_NODES.east, to: { x: 0.86, y: 0.4 } },
	pulse_pace: 2,
	label_x: 2,
	gap: 2,
	blink: 10,
	blink_lit: 6,
	tail: 24,
}

// NOTICE: the blocks that scramble, the ring's growth, the header's bar and the play-out's beats.
const INTRUSION = {
	play: 100,
	block_w: 8,
	block_h: 2,
	most: 0.8,
	salt: 75,
	glyph_salt: 76,
	gap_salt: 77,
	gaps: 0.35,
	hold: 3,
	glyphs: String.raw`0123456789ABCDEF<>/\░▒`,
	reach: 0.42,
	flash: 6,
	shrink_from: 60,
	shrink_ticks: 40,
	restore_from: 10,
	restore_ticks: 80,
	label: ' INTRUSION DETECTED ',
	restoring: ' BARRIER RESTORING ',
	restored: ' BARRIER RESTORED ',
	blink: 8,
	blink_lit: 5,
	bar_w: 6,
	bar_pace: 5,
	header_rows: 3,
}

// The opening: every cell a flickering digit until the wave reaches it — left to right, top to
// bottom, a scan line leading it. The line its sound counts is as long as the wave, a letter a tick.
const ASSEMBLE_LINE = '0110100101011010011010010110100110010110011010011001011001101001011010'
const ASSEMBLE = {
	line: ASSEMBLE_LINE,
	letter_ms: 50,
	wave_ticks: ASSEMBLE_LINE.length,
	slant: 0.25,
	sparse: 0.06,
	flicker: 2,
	salt: 78,
	ticks: 84,
}

// The ending: each character turns to a dot at its own moment, drifts upward and thins out.
const DRIFT = {
	delay: 18,
	rise: 0.35,
	thin: 36,
	fade: 12,
	glyphs: '·∙:',
	delay_salt: 79,
	thin_salt: 80,
	glyph_salt: 81,
	gone: 60,
	ticks: 84,
}

const theme_colors: ThemeColors = {
	body: '150;225;245',
	rule: RGB.rule,
	ok: RGB.cyan,
	red: '255;100;60',
	warn: RGB.orange,
	hi: RGB.white,
	type: RGB.cyan,
	notice: RGB.orange,
	// The marks' tones: info a quiet tint between the rule and the body, idle clearly dimmer than the
	// body, waiting on a person the one mild violet accent.
	info: '95;190;225',
	idle: '70;150;180',
	human: '190;185;255',
}

const theme_notes: Partial<Record<EventKey, string>> = {
	a: 'notice, progress, new lane, progress — every effect in turn',
	n: 'the ring of text grows out of the panel · blocks of the area scramble into noise · a cyan bar sweeps the header · the barrier restores block by block',
	p: 'a dive: rectangles zoom to the ring’s centre · hex pairs stream sideways · the ring spins faster',
	r: 'the lane decloaks out of noise, left to right · the net graph gains a node, a link drawing to it',
	i: 'a ring of text travels round an ellipse · a net graph pulses inside it · now and then a patch ripples',
}

const run_board_theme_ghost_data = {
	ASSEMBLE,
	CLOAK,
	DIVE,
	DRIFT,
	GRAPH,
	HEX_DIGITS,
	INKS,
	INTRUSION,
	RGB,
	RING,
	RIPPLE,
	STATUS,
	theme_colors,
	theme_notes,
}

export { run_board_theme_ghost_data }
