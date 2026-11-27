// The deviant theme's NOTICE tables beside the wall's own (`run-board-theme-deviant-data.ts` →
// `WALL`): the order and its prompt, the header's gauges and probability, the cracks, the shards,
// the returning color and the objective stamped in the afterglow.

const ORDER = {
	word: 'DON’T',
	tail: 'MOVE',
	tail_x: 6,
	glitch: 'OB7?X5NZ',
	beat: 3,
	odds: 0.4,
	when_salt: 1,
	where_salt: 2,
	what_salt: 3,
	clear_w: 12,
	stripes: 9,
	thin: 0.45,
	stripe_dark: 0.5,
}
// Where the order texts and the key prompts stand in the area, and when the later ones join, in
// ticks of the wall's build.
const ORDERS = {
	first: { row: 1, x: 3 },
	second: { row: 5, share: 0.2 },
	third: { row: 2, x: 20, after: 12 },
	prompt_back: 16,
	prompt_on: 12,
	prompt_after: 22,
	prompt_lag: 4,
	prompt_beat: 8,
	prompt_lit: 4,
	prompt_glow: 0.25,
}

// The cracks start at the first of the four quickening hits and creep on through the held stillness,
// reaching by the peak as far as they did before; then the wall in shards drifting down.
const CRACKS = {
	from: 20,
	pace: 0.72,
	rays: 11,
	short: 0.5,
	wide: 2.2,
	flat: 0.38,
	angle_salt: 1,
	length_salt: 2,
	ink_salt: 4,
}
const SHARDS = {
	ticks: 50,
	spark: 2,
	spark_ink: 0.6,
	odds: 0.3,
	glyphs: '▚▞▛▜▙▟',
	ink_salt: 8,
	seed_salt: 81,
	life_salt: 82,
	fall_salt: 83,
	glyph_salt: 84,
	fall_min: 0.1,
	fall_gain: 0.4,
}

// NOTICE's first second, in the header's left block: the order stamped two letters a tick, then the
// two choices as the source lays them out — IGNORE over OBEY, label then symbol — the plate on OBEY,
// fading up to IGNORE, which pulses once.
const PROMPT = {
	pace: 2,
	x: 2,
	list_after: 4,
	hold: 10,
	fade: 4,
	pulse_from: 16,
	pulse_ticks: 2,
	label_w: 8,
	obey: 'OBEY ✕',
	ignore: 'IGNORE ○',
	order_seed: 4,
	obey_seed: 5,
	ignore_seed: 6,
}

// NOTICE in the header's first row: the machine gauges as analysis bars that step up at each hit.
const GAUGES = {
	words: ['CPU', 'MEM', 'SWAP'],
	label_w: 5,
	gap: 2,
	base: 0.15,
	step: 0.1,
	sway: 0.1,
	salt: 85,
	seed: 7,
}

// NOTICE in the pinned column: the probability, falling through the build, rising from the peak — a
// chevron and the number, the label in two small lines at its right, the status line under them.
const ODDS = {
	start: 92,
	fall: 84,
	low: 8,
	rise: 91,
	rise_ticks: 60,
	label: 'PROBABILITY',
	sub: 'OF SUCCESS',
	label_x: 8,
	who: 'DEVIANT',
	rising: 'STABILIZING',
	falling: 'DESTABILIZING',
}

// The header's blocks give way to the board again, column by column, well before the notice ends.
const HEAD = { fade_from: 70, fade_ticks: 20, salt: 86 }

// The peak: color returns as a ring growing from the wall's middle, its edge white.
const RETURN = { ticks: 10, wide: 2.2, edge: 1.5 }

// The afterglow: the objective stamped across the data in two spaced lines, three letters a tick.
const OBJECTIVE = {
	from: 12,
	until: 100,
	pace: 3,
	chip_x: 1,
	text_x: 3,
	row: 1,
	thin: 'N O T I C E   R A I S E D',
	bold: 'R E A D   T H E   A L E R T',
	bold_after: 12,
	rule_w: 27,
}

const run_board_theme_deviant_notice = {
	CRACKS,
	GAUGES,
	HEAD,
	OBJECTIVE,
	ODDS,
	ORDER,
	ORDERS,
	PROMPT,
	RETURN,
	SHARDS,
}

export { run_board_theme_deviant_notice }
