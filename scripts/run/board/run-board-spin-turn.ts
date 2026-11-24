import type { Flash } from './run-board-change-flash'
import type { RuleCell } from './run-board-codes'
import type { DropScreen } from './run-board-drop-screen'
import type { JumpDraw } from './run-board-jump-screen'
import { run_board_labels } from './run-board-labels'
import type { Lamp } from './run-board-lamp-spots'
import type { NoticeTurn } from './run-board-notice-turn'
import type { PanelDraw, PanelMoment } from './run-board-panel-draw'
import type { Spot } from './run-board-spot'
import type { BoardPorts } from './run-board-state'
import type { StripCell } from './run-board-strip'
import type { Sweep } from './run-board-sweep'
import { run_board_type_rows, type Typing } from './run-board-type-rows'

// What a live `run:board` frame turns between redraws: the spinners, the sweep, the colons, the drops,
// the flash, the notice, the lamps, the rules' code, the strips and the TRACE field, and the moments
// they share. How each is drawn is its layer's (`run-board-layer-spin.ts`, `run-board-layer-effects.ts`).

const { SPINNER_INTERVAL_MS } = run_board_labels
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

type SpinPorts = Pick<
	BoardPorts,
	| 'now'
	| 'sleep'
	| 'write'
	| 'write_drawn'
	| 'time_draw'
	| 'time_wake'
	| 'typing_sound'
	| 'size'
	| 'drained'
	| 'restyle'
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

// The lamps' moment at `at_ms`: they burst on a step a row is still typing at the start of — the
// header's now line or a section's new row — and blink apart from the step after the last is typed
// through, so they change only on the spinner's step (joshuafolkken/kit#8237); the idle rain pours on the
// same moment (joshuafolkken/kit#8356).
function lamp_moment(turning: Turning, at_ms: number): PanelMoment {
	const step_ms = at_ms - (at_ms % SPINNER_INTERVAL_MS)

	const is_burst = run_board_type_rows.is_typing(turning.typing, step_ms)

	return { ms: at_ms, is_burst, jump: turning.jump?.run, arrive_ms: turning.arrive_ms }
}

const run_board_spin_turn = {
	blinking,
	coded,
	colons_of,
	lamp_moment,
	painting,
	spin_bytes,
	traces_of,
}

export { run_board_spin_turn }
export type { SpinPorts, Turning }
