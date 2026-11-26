import { run_board_theme_codec_face_head, type Spot } from './run-board-theme-codec-face-head'
import {
	run_board_theme_codec_face_shapes,
	type Face,
	type Look,
} from './run-board-theme-codec-face-shapes'

// One point of a codec portrait (joshuafolkken/kit#8917), ported from the confirmed theme demo's
// `fixed-v22-codec-faces.mjs`: the lit skin's details, the head and `level_at`.

const { HEAD, half_width, smooth } = run_board_theme_codec_face_shapes
const { BROW, base_light, brow_line, brow_lift, cheek_hollow, ear_level } =
	run_board_theme_codec_face_head
const { eye_level, hair_level, hairline_shade, mouth_level, within } =
	run_board_theme_codec_face_head

const SOCKET = { bottom: -0.03, inner: 0.1, outer: 0.38, shade: 0.14 }
const RIDGE = { top: -0.13, bottom: 0.17, x: 0.015, w: 0.032, lift: 0.1 }
const NOSE_SIDE = { top: -0.1, bottom: 0.2, inner: 0.035, outer: 0.09, shade: 0.22 }
const NOSE_BASE = { top: 0.19, bottom: 0.238, w: 0.1, shade: 0.32 }
const CHIN = { top: 0.45, bottom: 0.485, w: 0.09, shade: 0.16 }
const FOLD = { top: 0.2, bottom: 0.38, x: 0.12, slope: 0.5, w: 0.016 }
const STUBBLE = { below: 0.2, side_from: 0.4, side_to: 0.75, from: 0.4, to: 0.5 }
const LIP = { top: 0.26, bottom: 0.33, w: 0.17 }

// The sockets under the brows.
function socket_shade({ y, ax }: Spot): number {
	const is_socket =
		within(y, brow_line(ax), SOCKET.bottom) && within(ax, SOCKET.inner, SOCKET.outer)

	return is_socket ? -SOCKET.shade : 0
}

// The nose's ridge, its shaded side and its base.
function ridge_lift({ x, y }: Spot): number {
	const is_ridge = within(y, RIDGE.top, RIDGE.bottom) && Math.abs(x + RIDGE.x) < RIDGE.w

	return is_ridge ? RIDGE.lift : 0
}

function nose_side({ x, y }: Spot): number {
	const is_side = within(y, NOSE_SIDE.top, NOSE_SIDE.bottom)

	return is_side && within(x, NOSE_SIDE.inner, NOSE_SIDE.outer) ? -NOSE_SIDE.shade : 0
}

function nose_base({ y, ax }: Spot): number {
	return within(y, NOSE_BASE.top, NOSE_BASE.bottom) && ax < NOSE_BASE.w ? -NOSE_BASE.shade : 0
}

function chin_shade({ y, ax }: Spot): number {
	return within(y, CHIN.top, CHIN.bottom) && ax < CHIN.w ? -CHIN.shade : 0
}

function fold_shade({ face, y, ax }: Spot): number {
	if (face.fold <= 0 || !within(y, FOLD.top, FOLD.bottom)) return 0

	return Math.abs(ax - FOLD.x - FOLD.slope * (y - FOLD.top)) < FOLD.w ? -face.fold : 0
}

function stubble_shade({ face, y, ax, nx }: Spot): number {
	if (face.stubble <= 0 || y <= STUBBLE.below) return 0
	const lip = within(y, LIP.top, LIP.bottom) && ax < LIP.w ? 1 : 0
	const side = smooth(STUBBLE.side_from, STUBBLE.side_to, Math.abs(nx))

	return -(face.stubble * Math.max(side, smooth(STUBBLE.from, STUBBLE.to, y), lip))
}

const ADJUSTMENTS: ReadonlyArray<(spot: Spot) => number> = [
	brow_lift,
	hairline_shade,
	cheek_hollow,
	socket_shade,
	ridge_lift,
	nose_side,
	nose_base,
	chin_shade,
	fold_shade,
	stubble_shade,
]

function skin_level(spot: Spot): number {
	let level = base_light(spot)

	for (const adjust of ADJUSTMENTS) level += adjust(spot)

	return level
}

function is_outside(y: number, ax: number, half: number): boolean {
	return y < HEAD.cy - HEAD.ry || y >= HEAD.chin || ax >= half
}

// Inside the head's outline: the brows, the eyes, the mouth, then the skin.
function face_level(spot: Spot, look: Look): number {
	const { face, y, ax } = spot
	const is_brow = within(ax, BROW.inner, BROW.outer) && Math.abs(y - brow_line(ax)) < face.brow

	if (is_brow) return face.brow_level
	const eye = eye_level(face, ax, y, look)

	if (eye >= 0) return eye
	const mouth = mouth_level(ax, y, look)

	return mouth >= 0 ? mouth : skin_level(spot)
}

function head_level(face: Face, x: number, y: number, look: Look): number {
	const half = half_width(face, y)
	const ax = Math.abs(x)
	const hair = hair_level(face, x, y, half)

	if (hair >= 0) return hair
	if (is_outside(y, ax, half)) return ear_level(face, x, y)

	return face_level({ face, x, y, ax, nx: x / half }, look)
}

// How the portrait frames the face: `zoom` enlarges it, `center` is its height at the view's middle.
interface View {
	columns: number
	rows: number
	zoom: number
	center: number
}

const NECK = { below: 0.3, shade: 0.4, side: 0.14, from: -0.1, to: 0.25 }
const SCREEN = { level: 0.05, glow: 0.05 }

// One point of the portrait: the head over the clothes over the neck over the screen.
function level_at(face: Face, frame: { x: number; y: number }, look: Look, view: View): number {
	const x = frame.x / view.zoom
	const y = frame.y / view.zoom + view.center
	const head = head_level(face, x, y, look)

	if (head >= 0) return head
	const clothes = face.clothes(x, y)

	if (clothes >= 0) return clothes

	if (Math.abs(x) < face.neck && y > NECK.below) {
		return face.skin - NECK.shade - NECK.side * smooth(NECK.from, NECK.to, x)
	}

	return SCREEN.level + SCREEN.glow * smooth(1, -1, y)
}

const run_board_theme_codec_face_level = { head_level, level_at, skin_level }

export { run_board_theme_codec_face_level }
export type { View }
