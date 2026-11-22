import { run_board_cut_styled } from './run-board-cut-styled'
import type { KeyedLine } from './run-board-type-rows'

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

const run_board_frame_diff = { cells_of, changed }

export { run_board_frame_diff }
export type { ChangedCell }
