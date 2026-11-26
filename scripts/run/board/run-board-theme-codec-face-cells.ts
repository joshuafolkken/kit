import { run_board_theme_codec_face_level, type View } from './run-board-theme-codec-face-level'
import { run_board_theme_codec_face_shapes, type Look } from './run-board-theme-codec-face-shapes'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'

// The codec portraits as cells (joshuafolkken/kit#8917), ported from the confirmed theme demo's
// `fixed-v22-codec-faces.mjs`: the face sampled to an image, then written with FIT — each cell's
// 2 by 4 sub-pixels matched to the quadrant or `▂` `▆` glyph and the two greens that come closest.

const { FACES, clamp } = run_board_theme_codec_face_shapes
const { level_at } = run_board_theme_codec_face_level
const { hash } = run_board_theme_host_hash

type FaceName = keyof typeof FACES

const SUPER = 3
const LEVELS = 14
const FRAME_LEVEL = 0.6
const SUB = { columns: 2, rows: 4 }
const HALF = 2
// A sample point sits in the middle of its share of the pixel.
const MID = 0.5

// The green ramp of the screen, dark to bright; the dim one is the portrait that is not talking.
const STOPS: ReadonlyArray<string> = [
	'0;26;13',
	'18;84;46',
	'56;160;90',
	'120;240;150',
	'225;255;230',
]
const STOPS_DIM: ReadonlyArray<string> = [
	'0;18;9',
	'10;44;24',
	'28;84;48',
	'60;125;78',
	'110;140;115',
]

function channels(color = ''): Array<number> {
	return color.split(';').map(Number)
}

function ramp_color(stops: ReadonlyArray<string>, level: number): string {
	const at = (level / LEVELS) * (stops.length - 1)
	const index = Math.min(stops.length - HALF, Math.floor(at))
	const to = channels(stops[index + 1])

	return channels(stops[index])
		.map((channel, k) => Math.round(channel + ((to[k] ?? 0) - channel) * (at - index)))
		.join(';')
}

function ramp(stops: ReadonlyArray<string>): ReadonlyArray<string> {
	return Array.from({ length: LEVELS + 1 }, (_, level) => ramp_color(stops, level))
}

const RAMP = ramp(STOPS)
const RAMP_DIM = ramp(STOPS_DIM)

function quantized(level: number): number {
	return Math.round(clamp(level) * LEVELS)
}

// FULL is the codec call's view, cropped close. BUST is a narrow upright view cut out of FULL at the
// same pixel scale — three cells off either side and one off the top — so the brows, eyes and
// mouth fall on the same sub-pixels of their cells as in FULL.
const FULL = { columns: 16, rows: 8, zoom: 1.38, center: -0.02 }
const BUST_ROWS = 7
const BUST: View = {
	columns: 10,
	rows: BUST_ROWS,
	zoom: (FULL.zoom * FULL.rows) / BUST_ROWS,
	center: FULL.center + HALF / (FULL.zoom * FULL.columns),
}

type Image = Array<Array<number>>

interface Pixel {
	px: number
	py: number
	width: number
	height: number
}

// A pixel's level: the mean of SUPER by SUPER points across it.
function mean_at(face: FaceName, look: Look, pixel: Pixel, view: View): number {
	const { px, py, width, height } = pixel
	let sum = 0

	for (let step = 0; step < SUPER * SUPER; step++) {
		const sx = step % SUPER
		const sy = Math.floor(step / SUPER)
		const x = (px + (sx + MID) / SUPER - width / HALF) / (height / HALF)
		const y = (py + (sy + MID) / SUPER - height / HALF) / (height / HALF)

		sum += level_at(FACES[face], { x, y }, look, view)
	}

	return clamp(sum / (SUPER * SUPER))
}

function is_rim(pixel: Pixel): boolean {
	const { px, py, width, height } = pixel

	return px === 0 || py === 0 || px === width - 1 || py === height - 1
}

// The portrait as levels, two pixels a column and four a row of its view; the outermost ring is
// the glowing frame.
function image_of(face: FaceName, look: Look, view: View): Image {
	const width = view.columns * SUB.columns
	const height = view.rows * SUB.rows

	return Array.from({ length: height }, (_row, py) =>
		Array.from({ length: width }, (_column, px) => {
			const pixel = { px, py, width, height }

			return is_rim(pixel) ? FRAME_LEVEL : mean_at(face, look, pixel, view)
		}),
	)
}

const IMAGES = new Map<string, Image>()

// The image of a face, made once per mouth and eyes and reused.
function cached_image(face: FaceName, look: Look, view: View): Image {
	const key = `${face}${look.is_open ? 'o' : ''}${look.is_blink ? 'b' : ''}${String(view.columns)}x${String(view.rows)}`
	const known = IMAGES.get(key)

	if (known) return known
	const image = image_of(face, look, view)

	IMAGES.set(key, image)

	return image
}

const run_board_theme_codec_face_cells = { BUST, RAMP, RAMP_DIM, cached_image, hash, quantized }

export { run_board_theme_codec_face_cells }
export type { FaceName, Image }
