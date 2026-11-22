import { run_board_fold, type FrameBounds } from './run-board-fold'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_header_names } from './run-board-header-names'
import { run_board_labels } from './run-board-labels'
import type { Theme } from './run-board-theme-defs'

// The frame drawn while no run is read: one line under the header's own mark, and the footer.

const { WORDS, clock_of } = run_board_labels
const GAP = '  '

// When the reads off this machine last failed, and why.
type ReadFailure = Pick<BoardHeader, 'read_error' | 'read_failed_ms'>

// The frame's bounds, the last read failure and the screen's theme; unbounded, no failure and the
// plain board's name when omitted.
interface NoRunOptions {
	bounds?: FrameBounds
	failure?: ReadFailure
	theme?: Theme | undefined
}

// No run read here — or the reads failed, which the line says, and why, in place of `no run`: a read
// that failed cannot tell whether a run is there.
function no_run_line(
	now_ms: number,
	{ read_failed_ms, read_error }: ReadFailure,
	theme: Theme | undefined,
): string {
	const warning = run_board_header.warning_of(WORDS.read, read_failed_ms, read_error)
	const said = warning === undefined ? WORDS.no_run : undefined
	const parts = [
		`■ ${run_board_header_names.board_name_of(theme)}`,
		said,
		clock_of(now_ms),
		warning,
	]

	return parts.filter((part) => part !== undefined).join(GAP)
}

function render_no_run(
	now_ms: number,
	{ bounds = {}, failure = {}, theme }: NoRunOptions = {},
): Array<string> {
	const above = [no_run_line(now_ms, failure, theme)]
	const notes = { head: [], lines: [], hidden: 0 }

	return run_board_fold.bounded(
		{ above, plan: [], notes, legend: [], footer: bounds.footer ?? [] },
		bounds,
	)
}

const run_board_render_none = { render_no_run }

export { run_board_render_none }
