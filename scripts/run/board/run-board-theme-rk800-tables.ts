// The rk800 theme's later tables (`run-board-theme-rk800-data.ts` holds the first): the small
// corner notices, the lanes' LEDs and the ENDING's results screen.

// The small notices: one line on the THROUGHPUT rule, left of the level; `fade` ticks in, `hold`
// ticks held (two seconds), `fade` ticks out. `fall_lead` is how long before a NOTICE ends the
// falling notice starts, `every` the period the rising one returns on while the board's level
// stands above calm, `min_x` the column the rule's own label is clear of.
const NOTE = {
	fade: 3,
	hold: 40,
	gap: 1,
	min_x: 20,
	fall_lead: 30,
	every: 600,
	words: 'SOFTWARE INSTABILITY',
	up: '∧',
	down: '∨',
	path_sign: '▣',
	path: 'PATH UNLOCKED',
	// unconfirmed on the source: the words of a finished analysis.
	done_sign: '◇',
	done: 'ANALYSIS COMPLETE',
}

// The lanes' LEDs: how far the quiet tones are taken from the LED's blue to the night.
const LED = { info: 0.25, idle: 0.55 }

// ENDING: the board freezes grey, the light bars close over it, the results stand on the ice — the
// title, its status line typed two letters a tick, the numbers one after another — then the bars go
// dark and the empty screen holds a second.
const RESULTS = {
	bars_from: 6,
	bars_spread: 12,
	title_from: 22,
	title_fade: 6,
	status_from: 26,
	pace: 2,
	first_from: 38,
	step: 10,
	fade: 6,
	shut_from: 96,
	shut_spread: 12,
	shut_ticks: 16,
	empty_ticks: 20,
	grey: 0.3,
	column: 4,
	salt: 3,
	// The layout, in rows from the top and columns from the left margin.
	top: 1,
	x: 3,
	rule_w: 30,
	rule_cross: 22,
	title_row: 1,
	status_row: 2,
	numbers_row: 4,
	digit_rows: 3,
	block_gap: 5,
	block_min: 9,
	word: 'MISSION',
	rest: 'SUCCESSFUL',
	captions: { lanes: 'LANES', running: 'RUNNING', events: 'EVENTS', hours: 'HOURS' },
	hour_minutes: 60,
	day_hours: 24,
	year_days: 365,
}

// A menu's entrance: the ticks between its items' bars, the pause before their labels, and a fade.
const ENTER = { step: 2, pause: 2, fade: 4 }

// ROW's clue cards: where along the timeline their ticks stand.
const CARD_AT = { first: 0.3, second: 0.55, third: 0.85 }

const run_board_theme_rk800_tables = { CARD_AT, ENTER, LED, NOTE, RESULTS }

export { run_board_theme_rk800_tables }
