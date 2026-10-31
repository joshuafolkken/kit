import { run_board_fold, type FrameBounds } from './run-board-fold'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'

// The frame drawn while no run is read: one line under the header's own mark, and the footer.

const { WORDS, clock_of } = run_board_labels
const GAP = '  '

// When the reads off this machine last failed, and why.
type ReadFailure = Pick<BoardHeader, 'read_error' | 'read_failed_ms'>

// No run read here — or the reads failed, which the line says, and why, in place of `no run`: a read
// that failed cannot tell whether a run is there.
function render_no_run(
	now_ms: number,
	bounds: FrameBounds = {},
	failure: ReadFailure = {},
): Array<string> {
	const { read_failed_ms, read_error } = failure
	const warning = run_board_header.warning_of(WORDS.read, read_failed_ms, read_error)
	const said = warning === undefined ? WORDS.no_run : undefined
	const parts = ['■ backlogrun', said, clock_of(now_ms), warning]
	const above = [parts.filter((part) => part !== undefined).join(GAP)]
	const notes = { head: [], lines: [], hidden: 0 }

	return run_board_fold.bounded(
		{ above, plan: [], notes, legend: [], footer: bounds.footer ?? [] },
		bounds,
	)
}

const run_board_render_none = { render_no_run }

export { run_board_render_none }
