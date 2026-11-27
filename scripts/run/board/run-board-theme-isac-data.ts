import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { EventKey, ThemeColors } from './run-board-theme-host-types'

// The isac theme's tables: a field agent's HUD — one orange on black, a hexagonal dot field and ring
// pulses, the whole screen turning red on an alert. Its words are generic, its look is color and
// motion alone.

const { BOLD, bg, fg } = run_board_theme_host_grid

const RGB = {
	orange: '255;120;30',
	bright: '255;170;90',
	dim: '120;55;10',
	rule: '170;80;15',
	white: '240;240;240',
	pale: '255;200;120',
	red: '230;30;30',
	red_bright: '255;110;90',
	red_dim: '110;15;15',
	red_rule: '150;20;20',
}

const INKS = {
	ORANGE: fg(RGB.orange),
	BRIGHT: `${fg(RGB.bright)}${BOLD}`,
	DIM: fg(RGB.dim),
	WHITE: `${fg(RGB.white)}${BOLD}`,
	WARNING: `${fg(RGB.white)}${BOLD}${bg(RGB.red)}`,
	WARNING_OFF: `${fg(RGB.red_bright)}${BOLD}`,
	FLASH: `${fg(RGB.red)}${BOLD}${bg(RGB.white)}`,
}

// The alert's flip: each of the theme's own oranges inside a raw style and the red it turns to.
const RED_OF: ReadonlyArray<readonly [string, string]> = [
	[RGB.orange, RGB.red],
	[RGB.bright, RGB.red_bright],
	[RGB.dim, RGB.red_dim],
	[RGB.rule, RGB.red_rule],
]

// The panel's status block: its rows, the armor bar and its blinks.
const STATUS = {
	network_row: 0,
	agents_row: 1,
	armor_row: 2,
	uplink_row: 4,
	mark_x: 8,
	value_x: 10,
	armor_cells: 8,
	armor_lit: 6,
	shimmer_pace: 4,
	sample_agents: 3,
	blink: 40,
	blink_lit: 20,
}

// The hexagonal dot field: a dot every fourth column, every other row shifted two; a cell is twice
// as tall as it is wide, and a ring is this thick.
const HEX = { every: 4, shift: 2, aspect: 2, ring_w: 0.5 }

// The panel's scanner: its frame, the ring's period and pace, the contacts and how long one glows.
const SCAN = {
	x: 22,
	w: 18,
	h: 6,
	label: 'SCAN',
	period: 60,
	pace: 0.17,
	contacts: 3,
	salt: 61,
	glow: 1.5,
}

// PROGRESS: the transmission's waveform, the brackets closing on it and its tail.
const TX = {
	label_row: 1,
	wave_row: 2,
	wave_x: 4,
	wave_w: 30,
	top_row: 0,
	bottom_row: 4,
	levels: '▁▂▃▄▅▆▇█',
	hold: 2,
	salt: 62,
	gap: 2,
	close_ticks: 10,
	blink: 10,
	blink_lit: 6,
	linger: 16,
}

// ROW: the pulse's pace and period, when it crosses the lane, the label and its tail.
const PULSE = {
	ring_pace: 1,
	period: 50,
	cross_from: 6,
	cross_ticks: 8,
	label_x: 2,
	label_row: 1,
	label_w: 30,
	tail: 24,
}

// NOTICE: the pulses' pace rising to the peak, the hazard stripes, the banner and the red draining.
const ALERT = {
	play: 100,
	slow: 40,
	rush: 4,
	after: 16,
	max_reach: 60,
	stripes: '▚▚▚▚    ',
	stripe_pace: 2,
	banner: '   ▲  WARNING  ▲   ',
	build_label: ' SIGNAL ANOMALY ',
	drain_from: 20,
	drain_ticks: 80,
	full: 100,
}

// The opening: the title typing, the ring drawing clockwise, the brackets running out, the fade.
const OPEN = {
	title: 'TECH ONLINE',
	letter_ms: 50,
	radius: { x: 9, y: 4 },
	points: 48,
	ring_ticks: 30,
	expand_from: 30,
	expand_ticks: 30,
	fade_from: 60,
	fade_ticks: 30,
	pad: { x: 3, y: 2 },
	arm: '──',
	ticks: 100,
}

// The ending: the flare rising, the ring closing over the dimming board, the empty screen.
const FLARE = {
	rise_ticks: 18,
	close_from: 18,
	close_ticks: 36,
	reach: 0.75,
	ring_w: 0.04,
	least: 0.01,
	gone: 56,
	ticks: 80,
}

const theme_colors: ThemeColors = {
	body: RGB.orange,
	rule: RGB.rule,
	ok: RGB.bright,
	red: '255;70;50',
	warn: RGB.pale,
	hi: RGB.white,
	type: RGB.white,
	notice: RGB.pale,
	// The marks' tones: info a quiet tint between the rule and the body, idle clearly dimmer than the
	// body, waiting on a person the one cool accent.
	info: '235;140;75',
	idle: '190;100;40',
	human: '140;205;245',
}

// The roles' colors while the screen is red.
const red_colors: ThemeColors = {
	body: RGB.red,
	rule: RGB.red_rule,
	ok: RGB.red_bright,
	red: RGB.white,
	warn: RGB.red_bright,
	hi: RGB.white,
	type: RGB.white,
	notice: RGB.white,
}

const theme_notes: Partial<Record<EventKey, string>> = {
	a: 'notice, progress, new lane, progress — every effect in turn',
	n: 'the pulses come faster · hazard stripes march · every orange flips to red at the peak · WARNING · the red drains back left to right',
	p: 'INCOMING TRANSMISSION: a waveform in the panel, brackets closing on it',
	r: 'a pulse ring sweeps the area, the hex field lighting behind it · the lane is marked · AGENT ACTIVATED',
	i: 'the scanner pulses every three seconds, contacts glowing as the ring passes · the armor bar shimmers',
}

const run_board_theme_isac_data = {
	ALERT,
	FLARE,
	HEX,
	INKS,
	OPEN,
	PULSE,
	RED_OF,
	RGB,
	SCAN,
	STATUS,
	TX,
	red_colors,
	theme_colors,
	theme_notes,
}

export { run_board_theme_isac_data }
