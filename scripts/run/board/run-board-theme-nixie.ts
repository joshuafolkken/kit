import { run_board_theme_host_flash } from './run-board-theme-host-flash'
import type {
	EventKey,
	Grid,
	ThemeApi,
	ThemeColors,
	ThemeModule,
	ThemeState,
} from './run-board-theme-host-types'
import { run_board_theme_nixie_data, type NixieDraw } from './run-board-theme-nixie-data'
import { run_board_theme_nixie_ending } from './run-board-theme-nixie-ending'
import { run_board_theme_nixie_giant } from './run-board-theme-nixie-giant'
import { run_board_theme_nixie_idle } from './run-board-theme-nixie-idle'
import { run_board_theme_nixie_mail } from './run-board-theme-nixie-mail'
import { run_board_theme_nixie_meter } from './run-board-theme-nixie-meter'
import { run_board_theme_nixie_notice } from './run-board-theme-nixie-notice'
import { run_board_theme_nixie_opening } from './run-board-theme-nixie-opening'
import { run_board_theme_nixie_shift } from './run-board-theme-nixie-shift'
import { run_board_theme_nixie_typing } from './run-board-theme-nixie-typing'

// The STEINS;GATE theme (joshuafolkken/kit#8917), ported from the confirmed theme demo.
// Idle: the divergence meter in the panel, flush with the rules' right end; tubes breathe.
// PROGRESS: the meter spins and locks on an α value; letters roll in; a ripple of digits crosses.
// ROW: every digit on the board spins, sparks fly, the lane rolls in; a full world line shift.
// NOTICE: a D-mail — discharges cross the whole area, the board dissolves into digits, the screen
// flashes three times and tears for over a second, and the meter locks on a β value.

const { notice_trace } = run_board_theme_host_flash
const { COLOR } = run_board_theme_nixie_data
const { nixie_ending } = run_board_theme_nixie_ending
const { giant_meter } = run_board_theme_nixie_giant
const { idle_current, idle_misread, idle_noise } = run_board_theme_nixie_idle
const { mail } = run_board_theme_nixie_mail
const { divergence_meter } = run_board_theme_nixie_meter
const { aftershocks, discharge, dissolve, resettle } = run_board_theme_nixie_notice
const { nixie_opening } = run_board_theme_nixie_opening
const { ripple, world_line_shift } = run_board_theme_nixie_shift
const { rolling_letters, sparks, spinning_digits } = run_board_theme_nixie_typing

// A new lane's newest eight letters roll.
const ROW_TAIL = 8

const COLORS: ThemeColors = {
	body: '255;140;45',
	rule: '120;55;15',
	ok: '255;200;110',
	red: '255;80;50',
	warn: '255;215;130',
	hi: '255;235;200',
	type: '255;225;170',
	notice: COLOR.label,
}

const NOTES: Partial<Record<EventKey, string>> = {
	a: 'notice, progress, new lane, progress — every effect in turn',
	n: 'D-MAIL arrives · the meter takes the whole area in giant digits, spins, then locks digit by digit on β · flashes, tears',
	p: 'the meter spins, locks on an α value · letters roll in · a ripple of digits crosses',
	r: 'every digit spins, sparks fly, the lane rolls in · a world line shift · α world line',
	i: 'tubes breathe and flicker · every 6 s a current runs along the rules and the tubes swell · a digit misreads · a row slips',
}

// While an event types: the trace, the spinning digits, the board dissolving and the letters rolling.
function typing_layers(frame: NixieDraw): void {
	const { grid, state } = frame

	notice_trace(grid, state, COLOR.label)
	spinning_digits(frame)
	sparks(frame)
	dissolve(frame)
	resettle(frame)
	rolling_letters(frame, state.notice_text)
	rolling_letters(frame, state.progress)
	rolling_letters(frame, state.row, ROW_TAIL)
}

// Over everything: the discharges, the idle life, and what an event leaves behind.
function closing_layers(frame: NixieDraw): void {
	discharge(frame)
	idle_noise(frame)
	idle_current(frame)
	idle_misread(frame)
	ripple(frame)
	aftershocks(frame)
	world_line_shift(frame)
}

function steins_gate(api: ThemeApi, grid: Grid, state: ThemeState, tick: number): void {
	const frame = { api, grid, state, tick }

	typing_layers(frame)

	if (!giant_meter(frame)) {
		divergence_meter(frame)
		mail(frame)
	}

	closing_layers(frame)
}

function theme(api: ThemeApi): ThemeModule {
	return {
		name: 'STEINS;GATE',
		// The lab's PC and phone screens: text as written.
		board: 'josh-nixie',
		capitals: false,
		spinner: '0123456789',
		notes: NOTES,
		colors: COLORS,
		opening: nixie_opening(api),
		ending: nixie_ending(api),
		draw: (grid, state, tick) => {
			steins_gate(api, grid, state, tick)
		},
	}
}

const run_board_theme_nixie = { theme }

export { run_board_theme_nixie }
