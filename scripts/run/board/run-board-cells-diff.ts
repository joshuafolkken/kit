import { run_board_cells, type Cells } from './run-board-cells'

// The bytes that turn the terminal's screen (`front`) into the composed one (`back`), the same size
// (joshuafolkken/kit#8826): only the cells that differ, each run of them after one cursor move, a style
// written only where it changes. A wide character's second cell that changed is written from its first.
// `front` is then made `back`, as the terminal shows it once the bytes are written. Nothing changed
// writes nothing.

const { CONTINUATION, DEFAULT_STYLE, char_text, copy, style_of } = run_board_cells
const CSI = '\u{1B}['
const RESET = `${CSI}0m`
const OSC_LINK = '\u{1B}]8;;'
const ST = '\u{1B}\\'
const UNKNOWN = -1
const WIDE = 2

// Where the cursor is after the bytes written so far, and the style and link they left it in.
interface Writer {
	out: Array<string>
	cursor: number
	style: number
	link: string
}

function is_changed(back: Cells, front: Cells, index: number): boolean {
	return back.chars[index] !== front.chars[index] || back.styles[index] !== front.styles[index]
}

function move_to(cells: Cells, writer: Writer, index: number): void {
	if (writer.cursor === index) return
	const row = Math.floor(index / cells.columns) + 1
	const column = (index % cells.columns) + 1

	writer.out.push(`${CSI}${String(row)};${String(column)}H`)
}

function link_to(writer: Writer, link: string): void {
	if (writer.link === link) return
	writer.out.push(`${OSC_LINK}${link}${ST}`)
	writer.link = link
}

function style_to(writer: Writer, style: number): void {
	if (writer.style === style) return
	const { sgr, link } = style_of(style)

	writer.out.push(`${RESET}${sgr}`)
	link_to(writer, link)
	writer.style = style
}

// Whether the cell at `index` is a wide character's second cell.
function is_second(cells: Cells, index: number): boolean {
	return cells.chars[index] === CONTINUATION && index % cells.columns > 0
}

// The cell at `index` written, with its wide character's second cell; the next index to look at.
function write_cell(back: Cells, writer: Writer, index: number): number {
	const next = index + (is_second(back, index + 1) ? WIDE : 1)

	move_to(back, writer, index)
	style_to(writer, back.styles[index] ?? DEFAULT_STYLE)
	writer.out.push(char_text(back.chars[index] ?? CONTINUATION))
	// joshuafolkken/kit#8826: past a row's last column the terminal's cursor is not known to wrap.
	writer.cursor = next % back.columns === 0 ? UNKNOWN : next

	return next
}

// The first cell to write for a change at `index`: a wide character's first cell for its second.
function start_of(back: Cells, index: number): number {
	return is_second(back, index) ? index - 1 : index
}

function written(writer: Writer): string {
	if (writer.out.length === 0) return ''
	link_to(writer, '')
	if (writer.style !== DEFAULT_STYLE) writer.out.push(RESET)

	return writer.out.join('')
}

function diff(back: Cells, front: Cells): string {
	const writer: Writer = { out: [], cursor: UNKNOWN, style: UNKNOWN, link: '' }
	let index = 0

	while (index < back.chars.length) {
		index = is_changed(back, front, index)
			? write_cell(back, writer, start_of(back, index))
			: index + 1
	}

	copy(back, front)

	return written(writer)
}

const run_board_cells_diff = { diff }

export { run_board_cells_diff }
