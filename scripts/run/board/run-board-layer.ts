import type { Cells } from './run-board-cells'

// One layer of a live `run:board` frame (joshuafolkken/kit#8826): when it next changes, and its cells
// at a moment drawn over the layers below it. The frame loop (`run-board-frame-loop.ts`) composes every
// layer in order and wakes at the first change; a decor layer is the first left behind when composing
// runs over its budget, drawn again at the moment it was last drawn at.

interface Layer {
	is_decor: boolean
	next_change_ms: (now_ms: number) => number
	draw: (canvas: Cells, at_ms: number) => void
}

// The first multiple of `interval_ms` after `now_ms`.
function boundary_after(now_ms: number, interval_ms: number): number {
	return now_ms - (now_ms % interval_ms) + interval_ms
}

const run_board_layer = { boundary_after }

export { run_board_layer }
export type { Layer }
