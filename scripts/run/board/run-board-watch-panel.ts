import { run_board_cut_styled } from './run-board-cut-styled'
import { run_board_fit } from './run-board-fit'

// joshuafolkken/kit#8607: the pinned issues' watch panel laid over the header's first lines, one pin a
// line, its widest line ending on the rules' right end. A header line running into the panel is cut
// with `…`; a header line no pin sits beside is left as it is. Widths are the drawn columns, which a
// theme and an icon set keep (`run-board-theme-glyphs.ts`), so the panel lines up in every look.

const GAP = '  '
const ELLIPSIS = '…'
// The fewest header columns kept beside the panel; a narrower board draws the header alone.
const MIN_HEADER_WIDTH = 40

const { width_of } = run_board_fit

// `line` in exactly `limit` columns: cut with `…` where it is wider, padded where it is narrower.
function fitted(line: string, limit: number): string {
	const cut =
		width_of(line) > limit
			? `${run_board_cut_styled.cut_styled(line, limit - ELLIPSIS.length)}${ELLIPSIS}`
			: line

	return `${cut}${' '.repeat(Math.max(0, limit - width_of(cut)))}`
}

// The header `lines` with the panel's `rows` at their right, the panel ending at `rule_width`.
function composed(
	lines: ReadonlyArray<string>,
	rows: ReadonlyArray<string>,
	rule_width: number,
): Array<string> {
	const limit = rule_width - Math.max(0, ...rows.map((row) => width_of(row))) - GAP.length

	if (rows.length === 0 || limit < MIN_HEADER_WIDTH) return [...lines]

	return lines.map((line, index) => {
		const row = rows[index]

		return row === undefined ? line : `${fitted(line, limit)}${GAP}${row}`
	})
}

const run_board_watch_panel = { GAP, MIN_HEADER_WIDTH, composed }

export { run_board_watch_panel }
