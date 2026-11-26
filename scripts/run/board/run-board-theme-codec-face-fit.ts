import {
	run_board_theme_codec_face_cells,
	type FaceName,
	type Image,
} from './run-board-theme-codec-face-cells'
import type { Look } from './run-board-theme-codec-face-shapes'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Grid, Point } from './run-board-theme-host-types'

// The codec portraits written with FIT (joshuafolkken/kit#8917), ported from the confirmed theme
// demo's `fixed-v22-codec-faces.mjs`: each cell's 2 by 4 sub-pixels matched to the quadrant or
// `▂` `▆` glyph and the two greens that come closest. The image is sampled at the sub-pixels'
// own size, so it is used as it is, with no resampling.

const { BUST, RAMP, RAMP_DIM, cached_image, hash, quantized } = run_board_theme_codec_face_cells
const { bg, fg, set_cell } = run_board_theme_host_grid

const SUB = { columns: 2, rows: 4 }
const QUADRANT_ROWS = 2
const BINARY = 2

// A glyph and which of its cell's sub-pixels (row * 2 + column) it covers.
interface Glyph {
	glyph: string
	covers: ReadonlyArray<boolean>
}

const QUADRANTS = [' ', '▘', '▝', '▀', '▖', '▌', '▞', '▛', '▗', '▚', '▐', '▜', '▄', '▙', '▟', '█']
const SUB_PIXELS = SUB.columns * SUB.rows

// Quadrant `index`'s bits: 1 upper left, 2 upper right, 4 lower left, 8 lower right.
function quadrant_covers(index: number): ReadonlyArray<boolean> {
	return Array.from({ length: SUB_PIXELS }, (_, bit) => {
		const row = Math.floor(bit / SUB.columns)
		const quarter = Math.floor(row / QUADRANT_ROWS) * SUB.columns + (bit % SUB.columns)

		return Math.floor(index / BINARY ** quarter) % BINARY === 1
	})
}

function lower_rows(rows: number): ReadonlyArray<boolean> {
	return Array.from({ length: SUB_PIXELS }, (_, bit) => bit >= (SUB.rows - rows) * SUB.columns)
}

const LOWER = { quarter: 1, three_quarters: 3 }

// The quadrants but the blank and the full block, then the lower quarter and three quarters, in
// the demo's order: a tie keeps the first.
const GLYPHS: ReadonlyArray<Glyph> = [
	...QUADRANTS.slice(1, -1).map((glyph, index) => ({ glyph, covers: quadrant_covers(index + 1) })),
	{ glyph: '▂', covers: lower_rows(LOWER.quarter) },
	{ glyph: '▆', covers: lower_rows(LOWER.three_quarters) },
]

interface Fit {
	error: number
	glyph: string
	on: number
	off: number
}

// The mean of the sub-pixels on one side of a glyph, summed in bit order as the demo sums them.
function side_mean(
	values: ReadonlyArray<number>,
	covers: ReadonlyArray<boolean>,
	is_on: boolean,
): number {
	const side = values.filter((_, bit) => covers.at(bit) === is_on)
	let sum = 0

	for (const value of side) sum += value

	return sum / side.length
}

function fit_of(values: ReadonlyArray<number>, { glyph, covers }: Glyph): Fit {
	const on = side_mean(values, covers, true)
	const off = side_mean(values, covers, false)
	let error = 0

	for (const [bit, value] of values.entries()) {
		error += (value - (covers.at(bit) === true ? on : off)) ** BINARY
	}

	return { error, glyph, on, off }
}

// The glyph and two levels that come closest to a cell's sub-pixels.
function fitted(values: ReadonlyArray<number>): Fit {
	let best: Fit = { error: Infinity, glyph: ' ', on: 0, off: 0 }

	for (const glyph of GLYPHS) {
		const fit = fit_of(values, glyph)

		if (fit.error < best.error) best = fit
	}

	return best
}

// How a portrait looks this tick: talking or not, its mouth and eyes.
interface FaceLook extends Look {
	is_talking: boolean
	tick: number
}

const LIVELY = { band_speed: 1.5, band_w: 2, scan: 0.07, floor: 0.1, salt: 900, share: 0.03 }
const GLINT = 0.14

// A talking portrait shimmers, a pixel here and there a step brighter for a tick, and a scan band
// rolls down it.
function lively(image: Image, look: FaceLook): Image {
	if (!look.is_talking) return image
	const band = (look.tick * LIVELY.band_speed) % (image.length * BINARY)

	return image.map((row, y) =>
		row.map((value, x) => {
			const scan = Math.abs(y - band) < LIVELY.band_w ? LIVELY.scan : 0
			const is_glint = value > LIVELY.floor && hash(look.tick, x, y + LIVELY.salt) < LIVELY.share

			return (is_glint ? value + GLINT : value) + scan
		}),
	)
}

function cell_values(image: Image, cx: number, cy: number): Array<number> {
	return Array.from({ length: SUB_PIXELS }, (_, bit) => {
		const sy = Math.floor(bit / SUB.columns)

		return image[cy * SUB.rows + sy]?.[cx * SUB.columns + (bit % SUB.columns)] ?? 0
	})
}

// One cell of the portrait: its glyph over two greens, a blank when the two are one.
function face_cell(values: ReadonlyArray<number>, colors: ReadonlyArray<string>): [string, string] {
	const { glyph, on, off } = fitted(values)
	const [front, back] = [quantized(on), quantized(off)]
	const style = `${fg(colors[front] ?? '')}${bg(colors[back] ?? '')}`

	return [front === back ? ' ' : glyph, style]
}

// A bust portrait of `face` with its top left at `at`.
function bust_portrait(grid: Grid, at: Point, face: FaceName, look: FaceLook): void {
	const image = lively(cached_image(face, look, BUST), look)
	const colors = look.is_talking ? RAMP : RAMP_DIM

	for (let cell = 0; cell < BUST.columns * BUST.rows; cell++) {
		const cx = cell % BUST.columns
		const cy = Math.floor(cell / BUST.columns)

		set_cell(grid, { y: at.y + cy, x: at.x + cx }, face_cell(cell_values(image, cx, cy), colors))
	}
}

const run_board_theme_codec_face_fit = { GLYPHS, bust_portrait, fitted, lively }

export { run_board_theme_codec_face_fit }
export type { FaceLook }
