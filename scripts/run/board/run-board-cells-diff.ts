import { run_board_cells, type Cells, type Style } from './run-board-cells'

// The bytes that turn the terminal's screen (`front`) into the composed one (`back`), the same size
// (joshuafolkken/kit#8826): only the cells that differ, each run of them after one cursor move, a style
// written only where it changes. A wide character's second cell that changed is written from its first.
// joshuafolkken/kit#8917: a run carries on through a few unchanged cells to the next changed one on its
// row, and a style that differs only by its trailing background is written as that background alone.
// `front` is then made `back`, as the terminal shows it once the bytes are written. Nothing changed
// writes nothing.

const { CONTINUATION, DEFAULT_STYLE, char_text, copy, style_of } = run_board_cells
const ESC = '\u{1B}'
const CSI = `${ESC}[`
const RESET = `${CSI}0m`
// joshuafolkken/kit#8242, #9069: every link opens with the same `id=`, so a terminal keying links by
// id and URL (xterm.js, VSCode's) keeps one record per URL however many frames redraw it — an id-less
// one is a new record each frame, dropped at once on leaving the alternate screen, freezing it for
// seconds. The id is written here, the last point before the terminal, as the cells keep the URL alone;
// the board's own links (`run-board-gather-record.ts` → `link`) open with this same definition.
const LINK_OPEN_WITH_ID = '8;id=josh-run-board;'
const LINK_CLOSE = `${ESC}]8;;`
const LINK_OPEN = `${ESC}]${LINK_OPEN_WITH_ID}`
const ST = '\u{1B}\\'
const UNKNOWN = -1
const WIDE = 2
// The most unchanged cells a run writes through rather than moving the cursor over them.
const MAX_GAP = 3
const BACKGROUND_TAIL = new RegExp(String.raw`${ESC}\[48;2;\d+;\d+;\d+m$`, 'u')
const DEFAULT_BACKGROUND = `${CSI}49m`
const LOOK_JOIN = '\u{0}'

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
	writer.out.push(link === '' ? `${LINK_CLOSE}${ST}` : `${LINK_OPEN}${link}${ST}`)
	writer.link = link
}

// The style's SGR without one trailing 24-bit background, with its link: two styles with the same
// look differ by that background alone.
function look_of(style: Style): { look: string; background: string } {
	const background = BACKGROUND_TAIL.exec(style.sgr)?.[0] ?? ''
	const base = style.sgr.slice(0, style.sgr.length - background.length)

	return { look: `${style.link}${LOOK_JOIN}${base}`, background }
}

// joshuafolkken/kit#8917: the background alone that turns the written style `from` into `to`, where
// nothing else differs; undefined where more does, or what was written is unknown.
function background_change(from: number, to: number): string | undefined {
	if (from === UNKNOWN) return undefined
	const before = look_of(style_of(from))
	const after = look_of(style_of(to))

	if (before.look !== after.look) return undefined

	return after.background === '' ? DEFAULT_BACKGROUND : after.background
}

function style_to(writer: Writer, style: number): void {
	if (writer.style === style) return
	const background = background_change(writer.style, style)

	if (background === undefined) {
		const { sgr, link } = style_of(style)

		writer.out.push(`${RESET}${sgr}`)
		link_to(writer, link)
	} else writer.out.push(background)
	writer.style = style
}

// Whether the cell at `index` is a wide character's second cell.
function is_second(cells: Cells, index: number): boolean {
	return cells.chars[index] === CONTINUATION && index % cells.columns > 0
}

// The cell at `index`'s style and character, written where the cursor is.
function write_plain(back: Cells, writer: Writer, index: number): void {
	style_to(writer, back.styles[index] ?? DEFAULT_STYLE)
	writer.out.push(char_text(back.chars[index] ?? CONTINUATION))
}

// The cell at `index` written, with its wide character's second cell; the next index to look at.
function write_cell(back: Cells, writer: Writer, index: number): number {
	const next = index + (is_second(back, index + 1) ? WIDE : 1)

	move_to(back, writer, index)
	write_plain(back, writer, index)
	// joshuafolkken/kit#8826: past a row's last column the terminal's cursor is not known to wrap.
	writer.cursor = next % back.columns === 0 ? UNKNOWN : next

	return next
}

// The first cell to write for a change at `index`: a wide character's first cell for its second.
function start_of(back: Cells, index: number): number {
	return is_second(back, index) ? index - 1 : index
}

// The next changed cell within `MAX_GAP` unchanged cells from `from` on the row it is on; undefined
// where there is none, or `from` starts a row, as the cursor is not known to wrap.
function next_changed(back: Cells, front: Cells, from: number): number | undefined {
	const column = from % back.columns

	if (column === 0) return undefined
	const end = Math.min(from + back.columns - column, from + MAX_GAP + 1)

	for (let index = from; index < end; index += 1) {
		if (is_changed(back, front, index)) return index
	}

	return undefined
}

function length_of(writer: Writer, write: (scratch: Writer) => void): number {
	const scratch: Writer = { ...writer, out: [] }

	write(scratch)

	return scratch.out.reduce((total, part) => total + part.length, 0)
}

// joshuafolkken/kit#8951: whether writing the unchanged cells `from` up to the changed `to`, then its
// style, is no longer than moving the cursor to it, then its style.
function rewrite_is_shorter(back: Cells, writer: Writer, from: number, to: number): boolean {
	const rewrite = length_of(writer, (scratch) => {
		for (let index = from; index < to; index += 1) write_plain(back, scratch, index)
		style_to(scratch, back.styles[to] ?? DEFAULT_STYLE)
	})
	const move = length_of(writer, (scratch) => {
		move_to(back, { ...scratch, cursor: UNKNOWN, out: scratch.out }, to)
		style_to(scratch, back.styles[to] ?? DEFAULT_STYLE)
	})

	return rewrite <= move
}

function run_continues(back: Cells, front: Cells, writer: Writer, from: number): boolean {
	const to = next_changed(back, front, from)

	// Nothing between: the changed cell is next, and no move is shorter than none.
	return to !== undefined && (to === from || rewrite_is_shorter(back, writer, from, to))
}

// joshuafolkken/kit#8917: the run of cells from `start`, written after one cursor move: unchanged cells
// ride along where a changed one follows within `MAX_GAP`, as writing them is shorter than a move.
// The next index to look at.
function write_run(back: Cells, front: Cells, writer: Writer, start: number): number {
	let index = write_cell(back, writer, start)

	while (run_continues(back, front, writer, index)) index = write_cell(back, writer, index)

	return index
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
			? write_run(back, front, writer, start_of(back, index))
			: index + 1
	}

	copy(back, front)

	return written(writer)
}

const run_board_cells_diff = { LINK_OPEN_WITH_ID, diff }

export { run_board_cells_diff }
