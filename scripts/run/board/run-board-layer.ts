import { run_board_cells, type Cells } from './run-board-cells'
import { run_board_cells_ansi } from './run-board-cells-ansi'

// One layer of a live `run:board` frame (joshuafolkken/kit#8826): when it next changes, and its cells
// at a moment drawn over the layers below it. The frame loop (`run-board-frame-loop.ts`) composes every
// layer in order and wakes at the first change; a decor layer is the first left behind when composing
// runs over its budget, drawn again at the moment it was last drawn at.

interface Layer {
	is_decor: boolean
	next_change_ms: (now_ms: number) => number
	draw: (canvas: Cells, at_ms: number) => void
}

// The bytes a provisional layer writes at `at_ms` over what it wrote at `since_ms`; everything with no
// `since_ms`.
type LayerBytes = (at_ms: number, since_ms: number | undefined) => string

// The cells a provisional layer has written, `UNSET` where it wrote none.
interface Overlay {
	cells: Cells | undefined
	since_ms: number | undefined
}

const { UNSET, CONTINUATION, cells_of, is_sized, put } = run_board_cells
const { paint, unpair } = run_board_cells_ansi
const NEVER = Infinity

// The first multiple of `interval_ms` after `now_ms`.
function boundary_after(now_ms: number, interval_ms: number): number {
	return now_ms - (now_ms % interval_ms) + interval_ms
}

// The overlay's cells for `canvas`'s size: a fresh one, which forgets what it wrote, on a new size.
function sized(overlay: Overlay, canvas: Cells): Cells {
	if (is_sized(overlay.cells, canvas)) return overlay.cells
	overlay.since_ms = undefined
	overlay.cells = cells_of(canvas, UNSET)

	return overlay.cells
}

// An overlay cell put on `canvas` where the overlay wrote it; a wide character's second cell goes with
// its first.
function blit_cell(overlay: Cells, canvas: Cells, index: number, char: number): void {
	if (char === UNSET) return
	if (char !== CONTINUATION) unpair(canvas, index)
	put(canvas, index, char, overlay.styles[index] ?? 0)
}

// Every overlay cell put on `canvas`.
function blit(overlay: Cells, canvas: Cells): void {
	for (const [index, char] of overlay.chars.entries()) blit_cell(overlay, canvas, index, char)
}

// A layer that still writes ANSI bytes, as the effect did before it had cells: what it writes since its
// last draw is painted onto its own overlay, which is put over the canvas. Drawn again at the same moment,
// it only puts its overlay back.
function bytes_layer(
	bytes: LayerBytes,
	next_change_ms: (now_ms: number) => number,
	is_decor = true,
): Layer {
	const overlay: Overlay = { cells: undefined, since_ms: undefined }

	return {
		is_decor,
		next_change_ms,
		draw: (canvas, at_ms) => {
			const cells = sized(overlay, canvas)

			if (overlay.since_ms !== at_ms) paint(cells, bytes(at_ms, overlay.since_ms))
			overlay.since_ms = at_ms
			blit(cells, canvas)
		},
	}
}

// One cell's character and style as painted from its bytes, and whether it is wide.
interface Glyph {
	char: number
	style: number
	is_wide: boolean
}

// One cell a glyph layer puts: the SGR bytes it is styled with and its text, no cursor.
interface GlyphBytes {
	style: string
	text: string
}

// The glyphs a layer puts at a moment, by `row;column`, 1-based.
type GlyphsAt = (at_ms: number) => ReadonlyMap<string, GlyphBytes>

// joshuafolkken/kit#8826: a glyph layer repaints thousands of cells every frame, each in one of a few
// styles, so each distinct style and each distinct text is painted once — painting every cell's bytes
// whole cost a jump frame tens of milliseconds. Past `KNOWN_GLYPHS` the memo starts over.
const KNOWN_GLYPHS = 4096
const GLYPH_SIZE = { rows: 1, columns: 2 }
const known_glyphs = new Map<string, Glyph>()

function painted_glyph(bytes: string): Glyph {
	const cells = cells_of(GLYPH_SIZE, UNSET)

	paint(cells, bytes)

	return {
		char: cells.chars[0] ?? UNSET,
		style: cells.styles[0] ?? 0,
		is_wide: cells.chars[1] === CONTINUATION,
	}
}

function known_glyph(bytes: string): Glyph {
	const known = known_glyphs.get(bytes)

	if (known !== undefined) return known
	if (known_glyphs.size >= KNOWN_GLYPHS) known_glyphs.clear()
	const glyph = painted_glyph(bytes)

	known_glyphs.set(bytes, glyph)

	return glyph
}

// A space styled stands for the style; the text painted plain gives the character and its width.
const STYLE_PROBE = ' '

function glyph_of(bytes: GlyphBytes): Glyph {
	const letter = known_glyph(bytes.text)

	return { ...letter, style: known_glyph(`${bytes.style}${STYLE_PROBE}`).style }
}

// Whether 1-based `place` is within `1..last`.
function is_within(place: number, last: number): boolean {
	return place >= 1 && place <= last
}

// The 0-based index of `row;column` on `canvas`; undefined off it.
function index_of(canvas: Cells, key: string): number | undefined {
	const split_at = key.indexOf(';')

	if (split_at === -1) return undefined
	const row = Number(key.slice(0, split_at))
	const column = Number(key.slice(split_at + 1))

	if (!is_within(row, canvas.rows) || !is_within(column, canvas.columns)) return undefined

	return (row - 1) * canvas.columns + column - 1
}

// Whether a wide glyph at `index` has the row's next cell for its second half.
function is_paired(canvas: Cells, index: number, glyph: Glyph): boolean {
	return glyph.is_wide && index % canvas.columns < canvas.columns - 1
}

// `glyph` put at `key`; a wide one takes the cell after it too, where the row has one.
function put_glyph(canvas: Cells, key: string, glyph: Glyph): void {
	const index = index_of(canvas, key)

	if (index === undefined || glyph.char === UNSET) return
	const is_pair = is_paired(canvas, index, glyph)

	unpair(canvas, index)
	if (is_pair) unpair(canvas, index + 1)
	put(canvas, index, glyph.char, glyph.style)
	if (is_pair) put(canvas, index + 1, CONTINUATION, glyph.style)
}

// A layer that puts single cells, each given as its bytes, over the canvas: what it puts at a moment is
// all it draws, so a cell it no longer puts shows the layers below it again.
function glyph_layer(
	cells_at: GlyphsAt,
	next_change_ms: (now_ms: number) => number,
	is_decor = true,
): Layer {
	return {
		is_decor,
		next_change_ms,
		draw: (canvas, at_ms) => {
			for (const [key, bytes] of cells_at(at_ms)) put_glyph(canvas, key, glyph_of(bytes))
		},
	}
}

// The next step of `interval_ms` where `is_on`; never otherwise.
function every(is_on: boolean, interval_ms: number): (now_ms: number) => number {
	return (now_ms) => (is_on ? boundary_after(now_ms, interval_ms) : NEVER)
}

function never(): number {
	return NEVER
}

const run_board_layer = { NEVER, boundary_after, bytes_layer, every, glyph_layer, never }

export { run_board_layer }
export type { GlyphBytes, GlyphsAt, Layer, LayerBytes }
