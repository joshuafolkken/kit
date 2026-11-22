import { run_board_cut_styled } from './run-board-cut-styled'
import { run_board_labels } from './run-board-labels'
import type { KeyedLine } from './run-board-type-rows'

const CSI = '\u{1B}['
// The white-green a rain drop's head is drawn in, which both the change flash and the deja vu paint.
const HEAD = `${CSI}38;2;225;255;225m`
const FRAME_MS = run_board_labels.SPINNER_INTERVAL_MS
const FAILED = run_board_labels.PHASE_ICONS.failed
const LANE_KEY = 'lanes:'
// The supervisor's process row, keyed by its pid while one runs (`run-board-render-processes.ts`).
const SUPERVISOR_KEY = /:supervisor:\d+$/u

// Display columns, rather than string offsets, keep ANSI and wide graphemes intact.
interface FrameCell {
	text: string
	column: number
	style: string
}

interface ChangedCell extends FrameCell {
	key: string
	row: number
}

// The line's drawn characters at their columns, each with the colors holding at it
// (`run_board_cut_styled.styled_pieces`) and the link it is drawn inside, so a rewritten glyph keeps
// both; a character that takes no column is left out.
function cells_of(text: string): Array<FrameCell> {
	let column = 1

	return run_board_cut_styled
		.styled_pieces(text)
		.filter((piece) => piece.width > 0)
		.map((piece) => {
			const cell = { text: piece.text, column, style: `${piece.style}${piece.link ?? ''}` }

			column += piece.width

			return cell
		})
}

function changed_in(before: KeyedLine | undefined, line: KeyedLine): Array<ChangedCell> {
	if (before?.row !== line.row) return []
	const previous = new Map(cells_of(before.text).map((cell) => [cell.column, cell.text]))

	return cells_of(line.text)
		.filter((cell) => previous.get(cell.column) !== cell.text)
		.map((cell) => ({ ...cell, key: line.key, row: line.row }))
}

// New and moved rows establish a base; only characters on a stable row flash.
function changed(
	before: ReadonlyArray<KeyedLine>,
	lines: ReadonlyArray<KeyedLine>,
): Array<ChangedCell> {
	const previous = new Map(before.map((line) => [line.key, line]))

	return lines.flatMap((line) => changed_in(previous.get(line.key), line))
}

// The frames since `start_ms`, counted on the spinner's beat both effects draw on.
function frames_between(start_ms: number, now_ms: number): number {
	return Math.floor(now_ms / FRAME_MS) - Math.floor(start_ms / FRAME_MS)
}

// Counted on the row as produced: a theme may draw 💥 as other glyphs (`KeyedLine.source`).
function failures_in(line: KeyedLine): number {
	return (line.source ?? line.text).split(FAILED).length - 1
}

// A lane newly failed: one more 💥 on its row — a recovered lane keeps its earlier 🚢💥 in its
// track, so a row that only still shows one does not count.
function is_failure(before: KeyedLine | undefined, line: KeyedLine): boolean {
	if (before === undefined || !line.key.startsWith(LANE_KEY)) return false

	return failures_in(line) > failures_in(before)
}

function supervisor_in(lines: ReadonlyArray<KeyedLine>): KeyedLine | undefined {
	return lines.find((line) => SUPERVISOR_KEY.test(line.key))
}

// A replaced supervisor: its row's key names another pid; one starting or stopping is no change.
function replaced(
	before: ReadonlyArray<KeyedLine>,
	lines: ReadonlyArray<KeyedLine>,
): Array<KeyedLine> {
	const [was, line] = [supervisor_in(before), supervisor_in(lines)]

	return was === undefined || line === undefined || was.key === line.key ? [] : [line]
}

// joshuafolkken/kit#8470: the rows whose run changed under them — a lane that failed and the
// supervisor's row when another supervisor took over; an ordinary value change is not one.
function events(
	before: ReadonlyArray<KeyedLine>,
	lines: ReadonlyArray<KeyedLine>,
): Array<KeyedLine> {
	const previous = new Map(before.map((line) => [line.key, line]))

	return [
		...lines.filter((line) => is_failure(previous.get(line.key), line)),
		...replaced(before, lines),
	]
}

const run_board_frame_diff = { CSI, FRAME_MS, HEAD, cells_of, changed, events, frames_between }

export { run_board_frame_diff }
export type { ChangedCell }
