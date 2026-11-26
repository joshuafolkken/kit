// joshuafolkken/kit#8939: the redraws a live board was asked for — a demo-mode switch, a fold or the sound
// switch — counted, so the second drawing the old screen ends at the frame loop's next check
// (`run-board-frame-loop.ts` → `is_current`) and the board is redrawn at once, not on the next second.

interface Repaint {
	count: number
}

function repaint_of(): Repaint {
	return { count: 0 }
}

function request(repaint: Repaint | undefined): void {
	if (repaint !== undefined) repaint.count += 1
}

// Whether no redraw was asked for since this check was taken; none without a repaint to watch.
function current_of(repaint: Repaint | undefined): (() => boolean) | undefined {
	if (repaint === undefined) return undefined
	const { count } = repaint

	return () => repaint.count === count
}

const run_board_repaint = { current_of, repaint_of, request }

export { run_board_repaint }
export type { Repaint }
