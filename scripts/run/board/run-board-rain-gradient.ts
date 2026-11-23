import { run_board_header_trace } from './run-board-header-trace'
import type { Paint } from './run-board-labels'

// joshuafolkken/kit#8742: the matrix code rain's one gradient, which the reveal, the exit wipe, the board's
// drop and the idle rain all paint through. The head is three cells white to green, the two lead cells a
// fresh glyph every frame; the tail below them dims a color a cell on an eased curve, from the trace's
// bright green down to an ember near black; a tail cell that rerolled its glyph this frame flares for it.

type Rgb = ReadonlyArray<number>

const { SHADES } = run_board_header_trace
const CHANNEL_MAX = 255

// The channels of an `R;G;B` escape's color.
function channels_of(rgb: string): Rgb {
	return rgb.split(';').map(Number)
}

const BRIGHT = channels_of(SHADES.bright.rgb)
// Below the darkest trace green, where the tail melts into the black background.
const EMBER = channels_of('0;22;5')
// The head's cells, nearest first: white-green, then mixed 45% and 80% of the way to the bright green.
const HEAD_RGB: ReadonlyArray<string> = ['225;255;225', '124;255;153', '45;255;97']
const FLICKER_CELLS = 2
const EASE = 1.8
const GLINT = 1.7

function mix(from: Rgb, to: Rgb, share: number): Array<number> {
	return from.map((channel, index) => Math.round(channel + ((to[index] ?? 0) - channel) * share))
}

// The tail's color `distance` cells below the head in a tail of `length` cells.
function tail_rgb(distance: number, length: number): Array<number> {
	const along = (distance - HEAD_RGB.length) / Math.max(1, length - HEAD_RGB.length)

	return mix(EMBER, BRIGHT, (1 - along) ** EASE)
}

// A tail cell's color flared for the frame its glyph rerolled, each channel capped at full.
function glinted(rgb: ReadonlyArray<number>): Array<number> {
	return rgb.map((channel) => Math.min(CHANNEL_MAX, Math.round(channel * GLINT)))
}

function tail_paint(distance: number, length: number, is_glint: boolean): Paint {
	const rgb = tail_rgb(distance, length)

	return { rgb: (is_glint ? glinted(rgb) : rgb).join(';'), named: SHADES.bright.named }
}

// The head's paint `distance` cells from it; none below the head's cells.
function head_paint(distance: number): Paint | undefined {
	const rgb = HEAD_RGB[distance]

	return rgb === undefined ? undefined : { rgb, named: SHADES.head.named }
}

// Whether `distance` above the head falls on the head or a tail of `length` cells.
function is_in_rain(distance: number, length: number): boolean {
	return distance >= 0 && distance <= length
}

// The paint `distance` cells above the head (0 the head) in a tail of `length` cells; a tail cell that
// rerolled its glyph this frame (`is_glint`) flares. None past the tail. Where stdout has no 24-bit color
// every cell falls back to the trace's green.
function paint_at(distance: number, length: number, is_glint = false): Paint | undefined {
	if (!is_in_rain(distance, length)) return undefined

	return head_paint(distance) ?? tail_paint(distance, length, is_glint)
}

// Whether the cell `distance` above the head draws a fresh glyph every frame.
function is_flicker(distance: number): boolean {
	return distance >= 0 && distance < FLICKER_CELLS
}

const run_board_rain_gradient = { HEAD_RGB, is_flicker, paint_at }

export { run_board_rain_gradient }
