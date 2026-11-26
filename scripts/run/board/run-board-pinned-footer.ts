import { run_board_fit, type FrameParts, type TerminalSize } from './run-board-fit'

// A frame ended on a pinned footer: rows drawn in place of the legend and the footer, which a short pane
// never takes — demo mode's selector (`run-board-demo-footer.ts`). The pane's rows are theirs first and
// the rest of the frame is fit into what is left, so the body gives way in its own order
// (`run-board-fit.ts`) and the header goes before they do; a pane shorter than the pinned rows keeps the
// last of them. A frame with none is fit as it always was.

const { fit, height_of, whole } = run_board_fit

// The pane a frame is kept within and the rows pinned to its end, none where the frame has none.
interface Pane {
	size?: TerminalSize | undefined
	pinned_footer?: ReadonlyArray<string> | undefined
}

// The last of the pinned rows the pane holds: all of them but in a pane shorter than they are.
function held(rows: ReadonlyArray<string>, size: TerminalSize): Array<string> {
	let used = 0

	return rows
		.toReversed()
		.filter((row) => {
			used += height_of(row, size.columns)

			return used <= size.rows
		})
		.toReversed()
}

function height(rows: ReadonlyArray<string>, columns: number): number {
	return rows.reduce((sum, row) => sum + height_of(row, columns), 0)
}

// The frame over its pinned rows, kept within `size`.
function pinned_fit(
	parts: FrameParts,
	pinned: ReadonlyArray<string>,
	size: TerminalSize,
): Array<string> {
	const rows = held(pinned, size)
	const left = size.rows - height(rows, size.columns)

	return [...fit(parts, { ...size, rows: left }), ...rows]
}

// A live frame kept within its terminal, any other drawn whole; ended on its pinned rows where it has
// any, its legend and footer left out.
function fitted(parts: FrameParts, pane: Pane): Array<string> {
	const { size, pinned_footer: pinned } = pane

	if (pinned === undefined) return size === undefined ? whole(parts) : fit(parts, size)
	const bare = { ...parts, legend: [], footer: [] }

	return size === undefined ? [...whole(bare), ...pinned] : pinned_fit(bare, pinned, size)
}

const run_board_pinned_footer = { fitted }

export { run_board_pinned_footer }
