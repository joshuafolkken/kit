import type { Cells } from './run-board-cells'
import { run_board_cells_ansi } from './run-board-cells-ansi'
import { run_board_colon } from './run-board-colon'
import { run_board_labels } from './run-board-labels'
import { run_board_layer, type Layer } from './run-board-layer'
import { run_board_spin_turn, type Turning } from './run-board-spin-turn'

// The spinner layer of a live `run:board` frame in no theme (joshuafolkken/kit#8826): the spinners and
// the clock colons, each a function of the moment alone, restyled as the frame is. A themed board's
// theme layer turns and blinks its own (`run-board-theme-layer.ts`; joshuafolkken/kit#8917).

type Restyle = (text: string) => string

const { boundary_after } = run_board_layer
const { SPINNER_INTERVAL_MS, spinner_of } = run_board_labels
const { colon_boundary, colon_bytes } = run_board_colon
const { colons_of, spin_bytes } = run_board_spin_turn

// The spinners and the colons as they are at `at_ms`.
function spin_text(turning: Turning, at_ms: number): string {
	return `${spin_bytes(turning.spots, spinner_of(at_ms))}${colon_bytes(colons_of(turning), at_ms)}`
}

// The spinner's next step where it has spots, and the colons': a wake that changes nothing would push
// the next layer's step past `MIN_FRAME_MS` (joshuafolkken/kit#8826).
function spin_next(turning: Turning, now_ms: number): number {
	const spin_ms = turning.spots.length > 0 ? boundary_after(now_ms, SPINNER_INTERVAL_MS) : Infinity
	const colon_ms = colon_boundary(colons_of(turning), now_ms)

	return Math.min(spin_ms, colon_ms)
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

const run_board_layer_spin = { spin_layer }

export { run_board_layer_spin }
export type { Restyle }
