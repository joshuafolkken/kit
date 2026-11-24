import { run_board_change_flash, type Flash } from './run-board-change-flash'
import { run_board_codes, type RuleCell } from './run-board-codes'
import { run_board_colon } from './run-board-colon'
import type { DropScreen } from './run-board-drop-screen'
import { run_board_jump_screen, type JumpDraw } from './run-board-jump-screen'
import { run_board_labels } from './run-board-labels'
import type { Lamp } from './run-board-lamp-spots'
import { run_board_notice_turn, type NoticeTurn } from './run-board-notice-turn'
import {
	run_board_panel_draw as panel_draw,
	type PanelDraw,
	type PanelMoment,
} from './run-board-panel-draw'
import { run_board_rain_drop } from './run-board-rain-drop'
import { run_board_screen } from './run-board-screen'
import type { Spot } from './run-board-spot'
import type { BoardPorts } from './run-board-state'
import { run_board_strip, type StripCell } from './run-board-strip'
import { run_board_sweep, type Sweep } from './run-board-sweep'
import { run_board_timing } from './run-board-timing'
import { run_board_trace_spot } from './run-board-trace-spot'
import { run_board_type_rows, type Typing } from './run-board-type-rows'

// One turn of a live `run:board` frame between redraws — what is written at one wake: the spinners'
// frame, the sweep's cell, the colons, the drops, the flash, the notice, the lamps, the rules' code, the
// strips and the TRACE field. When the wakes come is `run-board-spin.ts`'s.

const { sweep_bytes } = run_board_sweep
const { colon_bytes } = run_board_colon
const { SPINNER_INTERVAL_MS, spinner_of } = run_board_labels
const CSI = '\u{1B}['
const RESET = `${CSI}0m`

// What is written between redraws: the spinners turned, the sweep moved, the lamps blinked, the rules'
// code run and the rows typing.
interface Turning {
	flash?: Flash | undefined
	spots: ReadonlyArray<Spot>
	typing: Typing
	sweep?: Sweep | undefined
	lamps?: ReadonlyArray<Lamp> | undefined
	panel?: PanelDraw | undefined
	traces?: ReadonlyArray<Spot> | undefined
	rules?: ReadonlyArray<RuleCell> | undefined
	strips?: ReadonlyArray<StripCell> | undefined
	// The frame's cells a drop falls down in place of the sweep (`run-board-rain-drop.ts`).
	drop?: DropScreen | undefined
	// The header clocks' colons, blinked every half second (`run-board-colon.ts`).
	colons?: ReadonlyArray<Spot> | undefined
	// The header notice traced in (`run-board-notice-turn.ts`).
	notice_trace?: NoticeTurn | undefined
	// The bttf time jump painted over the board (`run-board-jump-screen.ts`).
	jump?: JumpDraw | undefined
	// When the bttf panel's arrival started (`run-board-jump-start.ts`).
	arrive_ms?: number | undefined
}

// What changed since the last turn was written: the spinner's frame, the sweep's cell, the colons'
// half second, and the moment the lamps were last written at — none to write every lamp.
interface Turned {
	is_turned: boolean
	is_swept: boolean
	is_blinked?: boolean | undefined
	since: PanelMoment | undefined
}

type SpinPorts = Pick<
	BoardPorts,
	'now' | 'sleep' | 'write' | 'write_drawn' | 'time_draw' | 'time_wake' | 'typing_sound'
>

// One spinner frame at every spot: the cursor moved there, the spot's colors, the frame, then a reset.
function spin_bytes(spots: ReadonlyArray<Spot>, frame: string): string {
	return spots
		.map((spot) => `${CSI}${String(spot.row)};${String(spot.column)}H${spot.style}${frame}${RESET}`)
		.join('')
}

// The lamps blink once the first frame is out, the base the rows type against (joshuafolkken/kit#8236);
// an idle painter's area — the idle rain — runs from the first frame (joshuafolkken/kit#8356).
function blinking(turning: Turning): ReadonlyArray<Lamp> {
	const is_ready = turning.panel?.painter.is_idle === true || turning.typing.seen !== undefined

	return is_ready ? (turning.lamps ?? []) : []
}

// The theme's painter and its area where the lamps blink (joshuafolkken/kit#8676).
function painting(turning: Turning): PanelDraw | undefined {
	return blinking(turning).length > 0 ? turning.panel : undefined
}

function traces_of(turning: Turning): ReadonlyArray<Spot> {
	return turning.traces ?? []
}

function colons_of(turning: Turning): ReadonlyArray<Spot> {
	return turning.colons ?? []
}

// The rules run code only where the lamp panel blinks, so its gate is theirs (joshuafolkken/kit#8375).
function coded(turning: Turning): { typing: Typing; cells: ReadonlyArray<RuleCell> } {
	return {
		typing: turning.typing,
		cells: blinking(turning).length > 0 ? (turning.rules ?? []) : [],
	}
}

// The spinners turned when their frame changed, held while the bttf jump lights their places
// (joshuafolkken/kit#8782).
function spun_bytes(turning: Turning, at_ms: number, turned: Turned): string {
	if (!turned.is_turned || run_board_jump_screen.is_lit(turning.jump, at_ms)) return ''

	return spin_bytes(turning.spots, spinner_of(at_ms))
}

// The spinners turned, the sweep when its cell changed, then the rows typing written over them, in
// one synchronized write (joshuafolkken/kit#8125).
function turn_bytes(turning: Turning, at_ms: number, turned: Turned): string {
	const spin = spun_bytes(turning, at_ms, turned)
	const { sweep } = turning
	const swept = sweep !== undefined && turned.is_swept ? sweep_bytes(sweep, at_ms) : ''
	const blinked = turned.is_blinked === true ? colon_bytes(colons_of(turning), at_ms) : ''

	return run_board_screen.synced(
		`${spin}${swept}${blinked}${run_board_type_rows.type_bytes(turning.typing, at_ms)}`,
	)
}

// The drops' cells that changed since the last turn, written past the theme like the lamps: the
// screen holds each cell as the theme drew it, so a cell put back keeps a rule's own paint
// (joshuafolkken/kit#8367); the bttf jump's cells likewise (joshuafolkken/kit#8677).
function write_drop(turning: Turning, ports: SpinPorts, at_ms: number, turned: Turned): void {
	const since_ms = turned.since?.ms
	const bytes =
		run_board_rain_drop.drop_bytes(turning.drop, at_ms, since_ms) +
		run_board_jump_screen.jump_bytes(turning.jump, at_ms, since_ms)

	if (bytes === '') return
	const write = ports.write_drawn ?? ports.write

	write(run_board_screen.synced(bytes))
}

// joshuafolkken/kit#8657: the header notice traced over the drops and the flash, past the theme like
// the flash — at every turn, so a drop that crossed it is written over.
function write_notice(turning: Turning, ports: SpinPorts, at_ms: number): void {
	const bytes = run_board_notice_turn.notice_bytes(turning.notice_trace, at_ms)

	if (bytes !== '') ports.write_drawn?.(run_board_screen.synced(bytes))
}

// The lamps' moment at `at_ms`: they burst on a step a row is still typing at the start of — the
// header's now line or a section's new row — and blink apart from the step after the last is typed
// through, so they change only on the spinner's step (joshuafolkken/kit#8237); the idle rain pours on the
// same moment (joshuafolkken/kit#8356).
function lamp_moment(turning: Turning, at_ms: number): PanelMoment {
	const step_ms = at_ms - (at_ms % SPINNER_INTERVAL_MS)

	const is_burst = run_board_type_rows.is_typing(turning.typing, step_ms)

	return { ms: at_ms, is_burst, jump: turning.jump?.run, arrive_ms: turning.arrive_ms }
}

// The drops, then the turn built and written over them — a typing row drawn above the rain
// (joshuafolkken/kit#8370) — timed as a turn where `--timing` times draws, then the lamps that changed;
// the trill sounds on while a row is still typing, off once every row is typed through
// (joshuafolkken/kit#8250).
function write_turn(turning: Turning, ports: SpinPorts, at_ms: number, turned: Turned): void {
	run_board_timing.drawn(ports, 'turn', () => {
		write_drop(turning, ports, at_ms, turned)
		ports.write(turn_bytes(turning, at_ms, turned))
		run_board_change_flash.write(ports, turning.flash, at_ms, turned.since)
		write_notice(turning, ports, at_ms)
		panel_draw.write_panel(painting(turning), ports, lamp_moment(turning, at_ms), turned.since)
		run_board_codes.write_codes(coded(turning), ports, at_ms, turned.since?.ms)
		const striped = { ...coded(turning), strips: turning.strips ?? [] }

		run_board_strip.write_strips(striped, ports, at_ms, turned.since?.ms)
		run_board_trace_spot.write_traces(traces_of(turning), ports, at_ms, turned.since?.ms)
	})
	ports.typing_sound?.set(
		run_board_type_rows.is_typing(turning.typing, at_ms),
		run_board_type_rows.left_ms(turning.typing, at_ms),
	)
}

const run_board_spin_turn = {
	blinking,
	coded,
	colons_of,
	lamp_moment,
	painting,
	spin_bytes,
	traces_of,
	write_turn,
}

export { run_board_spin_turn }
export type { SpinPorts, Turned, Turning }
