import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Channel, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_wopr_data } from './run-board-theme-wopr-data'

// The WARGAMES theme's clock (joshuafolkken/kit#8917), ported from the confirmed theme demo: which
// event plays, the DEFCON level, the rules' cooling and the deterministic sources it draws from.

const { hash } = run_board_theme_host_hash
const { PEAK_TICKS, active } = run_board_theme_host_state
const { CLOSING, CODE } = run_board_theme_wopr_data

// The NOTICE's timeline, in ticks since the peak (c): the wars from c 4, the ending's three lines from
// c 147 for 91 ticks; the effect ends there. The three lines type `CLOSE_PACE` letters a tick, through
// by `CLOSE_TYPED` — the sound's pips stop and its typed end sounds there (joshuafolkken/kit#8917).
const WAR_START = 4
const CLOSE_FROM = 147
const CLOSE_PACE = 2
const CLOSE_TYPED = CLOSE_FROM + Math.ceil(CLOSING.join('').length / CLOSE_PACE)
const ENDING_TICKS = 91
const EFFECT_END = CLOSE_FROM + ENDING_TICKS
// The NOTICE's whole length from its start: the build to the peak, then `is_notice` holds while the
// notice's `cooled` is under EFFECT_END — 0 on the peak's last typing tick, so one tick fewer.
const NOTICE_TICKS = PEAK_TICKS + EFFECT_END - 1
const DEFCON = { calm: 5, row: 4 }
const NOT_COOLED = -1
// Park–Miller mix (run-board-lamps.ts:31-61): the one deterministic source kit's lamps and codes use.
const PARK_MILLER = { multiplier: 48_271, modulus: 2_147_483_647 }
const COUNT_WIDTH = 2
const SECOND_TICKS = 20
const SECONDS_WIDTH = 5
const SECONDS_DIGITS = 2

function mixed(values: ReadonlyArray<number>): number {
	let mix = 1

	for (const value of [...values, 0, 0]) {
		mix = ((mix + value) * PARK_MILLER.multiplier) % PARK_MILLER.modulus
	}

	return mix
}

function code_char(first: number, second: number, third: number): string {
	return CODE.charAt(Math.floor(hash(first, second, third) * CODE.length))
}

// NOTICE from its start to EFFECT_END ticks after the peak (longer than the host's NOTICE_END: the
// theme's `lasts.n` gives the event the room).
function is_notice(state: ThemeState): boolean {
	return active(state.notice, EFFECT_END)
}

// ROW plays while its lane types and ends with it.
function is_row(state: ThemeState): boolean {
	return state.row.is_typing && !is_notice(state)
}

// The PROGRESS strip plays while the now line types and nothing louder plays.
function is_progress(state: ThemeState): boolean {
	return state.progress.is_typing && !is_notice(state) && !is_row(state)
}

// The notice's age: ticks since it began (the build is 0..79, the peak at 79).
function notice_age(state: ThemeState, tick: number): number {
	return tick - state.notice.start
}

function notice_level(notice: Channel): number {
	if (notice.is_typing) {
		return Math.max(1, DEFCON.calm - Math.floor((DEFCON.calm * notice.length) / PEAK_TICKS))
	}

	return notice.cooled < CLOSE_FROM ? 1 : DEFCON.calm
}

// The DEFCON level: 5 calm; 4 while a lane types; over the notice's build 5 → 1 a step every 0.8 s,
// held at 1 through the trace's three bars, back to 5 for the last second.
function level_of(state: ThemeState): number {
	if (is_notice(state)) return notice_level(state.notice)

	return is_row(state) ? DEFCON.row : DEFCON.calm
}

// The channels kit types as keyed rows: the notice, the header's now line, a new lane row.
function channels(state: ThemeState): Array<Channel> {
	return [state.notice_text, state.progress, state.row].filter((typed) => typed.index >= 0)
}

function is_typing(state: ThemeState): boolean {
	return channels(state).some((typed) => typed.is_typing)
}

function notice_cooled(notice: Channel): number {
	if (notice.is_typing || notice.cooled < CLOSE_FROM) return NOT_COOLED

	return notice.cooled - CLOSE_FROM
}

// Ticks since the last row typed through; negative while one still types, Infinity before any did.
// A notice holds the rules in code until its third bar, then lets them scatter back.
function cooled_of(state: ThemeState): number {
	if (is_notice(state)) return notice_cooled(state.notice)
	const typed = channels(state)

	if (typed.some((each) => each.is_typing)) return NOT_COOLED

	return Math.min(Infinity, ...typed.map((each) => each.cooled))
}

function count(value: number): string {
	return String(value).padStart(COUNT_WIDTH, '0')
}

function seconds(ticks: number): string {
	return (Math.max(0, ticks) / SECOND_TICKS).toFixed(SECONDS_DIGITS).padStart(SECONDS_WIDTH, '0')
}

const run_board_theme_wopr_phase = {
	CLOSE_FROM,
	CLOSE_PACE,
	CLOSE_TYPED,
	EFFECT_END,
	NOTICE_TICKS,
	WAR_START,
	code_char,
	cooled_of,
	count,
	is_notice,
	is_progress,
	is_row,
	is_typing,
	level_of,
	mixed,
	notice_age,
	seconds,
}

export { run_board_theme_wopr_phase }
