import { run_board_cut_styled } from './run-board-cut-styled'
import { run_board_fit } from './run-board-fit'
import { run_board_row_key } from './run-board-row-key'

// joshuafolkken/kit#8607: the pinned issues' watch panel laid over the header's first lines, one pin a
// line, its widest line ending on the rules' right end. A header line running into the panel is cut
// with `…`; a header line no pin sits beside is left as it is. Widths are the drawn columns, which a
// theme and an icon set keep (`run-board-theme-glyphs.ts`), so the panel lines up in every look.

const GAP = '  '
const ELLIPSIS = '…'
// The fewest header columns kept beside the panel; a narrower board draws the header alone.
const MIN_HEADER_WIDTH = 40

const { width_of } = run_board_fit

// `line` cut with `…` to `limit` columns, the pin `row` after it in its own columns. The padding and the
// pin follow the line's end mark, so a typing header row types its own words alone
// (`run-board-row-key.ts`).
function fitted(line: string, row: string, limit: number): string {
	const { text } = run_board_row_key.split_key(line)
	const cut =
		width_of(text) > limit
			? `${run_board_cut_styled.cut_styled(text, limit - ELLIPSIS.length)}${ELLIPSIS}`
			: text
	const padding = ' '.repeat(Math.max(0, limit - width_of(cut)))

	return run_board_row_key.rekeyed(line, cut, `${padding}${GAP}${row}`)
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

		return row === undefined ? line : fitted(line, row, limit)
	})
}

const run_board_watch_panel = { GAP, MIN_HEADER_WIDTH, composed }

export { run_board_watch_panel }
