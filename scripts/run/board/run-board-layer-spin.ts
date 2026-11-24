import type { Cells } from './run-board-cells'
import { run_board_cells_ansi } from './run-board-cells-ansi'
import { run_board_colon } from './run-board-colon'
import { run_board_jump_screen } from './run-board-jump-screen'
import { run_board_labels } from './run-board-labels'
import { run_board_layer, type Layer } from './run-board-layer'
import { run_board_spin_turn, type Turning } from './run-board-spin-turn'
import { run_board_sweep } from './run-board-sweep'
import { run_board_theme_defs } from './run-board-theme-defs'
import { run_board_type_rows } from './run-board-type-rows'

// The layers of a live `run:board` frame the theme restyles (joshuafolkken/kit#8826): the spinners, the
// sweep and the clock colons, each a function of the moment alone, and the rows typing over them.

type Restyle = (text: string) => string

const { boundary_after, bytes_layer, every } = run_board_layer
const { SPINNER_INTERVAL_MS, spinner_of } = run_board_labels
const { SWEEP_MS, sweep_bytes } = run_board_sweep
const { colon_boundary, colon_bytes } = run_board_colon
const { colons_of, spin_bytes } = run_board_spin_turn
// joshuafolkken/kit#8349: the rows type at the wargames intro's pace; joshuafolkken/kit#8360 picks it
// per theme.
const LETTER_MS = run_board_theme_defs.THEME_DEFS.wargames.intro.letter_ms

// The spinners at `at_ms`, none while the bttf jump lights their places (joshuafolkken/kit#8782).
function spinners(turning: Turning, at_ms: number): string {
	if (run_board_jump_screen.is_lit(turning.jump, at_ms)) return ''

	return spin_bytes(turning.spots, spinner_of(at_ms))
}

// The spinners, the sweep and the colons as they are at `at_ms`.
function spin_text(turning: Turning, at_ms: number): string {
	const { sweep } = turning
	const swept = sweep === undefined ? '' : sweep_bytes(sweep, at_ms)

	return `${spinners(turning, at_ms)}${swept}${colon_bytes(colons_of(turning), at_ms)}`
}

// The spinner's next step where it has spots, the sweep's and the colons': a wake that changes nothing
// would push the next layer's step past `MIN_FRAME_MS` (joshuafolkken/kit#8826).
function spin_next(turning: Turning, now_ms: number): number {
	const spin_ms = turning.spots.length > 0 ? boundary_after(now_ms, SPINNER_INTERVAL_MS) : Infinity
	const sweep_ms = turning.sweep === undefined ? Infinity : boundary_after(now_ms, SWEEP_MS)
	const colon_ms = colon_boundary(colons_of(turning), now_ms)

	return Math.min(spin_ms, sweep_ms, colon_ms)
}

function spin_layer(turning: Turning, restyle: Restyle): Layer {
	return {
		is_decor: false,
		next_change_ms: (now_ms) => spin_next(turning, now_ms),
		draw: (canvas: Cells, at_ms: number) => {
			run_board_cells_ansi.paint(canvas, restyle(spin_text(turning, at_ms)))
		},
	}
}

// The rows typing, a letter at a time while any row types (joshuafolkken/kit#8370).
function typing_layer(turning: Turning, restyle: Restyle): Layer {
	const { typing } = turning

	return bytes_layer(
		(at_ms) => restyle(run_board_type_rows.type_bytes(typing, at_ms)),
		every(typing.lines.length > 0, LETTER_MS),
		false,
	)
}

const run_board_layer_spin = { spin_layer, typing_layer }

export { run_board_layer_spin }
export type { Restyle }
