import {
	run_board_theme_codec_face_shapes,
	type Face,
	type Look,
} from './run-board-theme-codec-face-shapes'

// The codec portraits' head (joshuafolkken/kit#8917), ported from the confirmed theme demo's
// `fixed-v22-codec-faces.mjs`: the hair, the ears, the brows, the eyes, the mouth and the lit skin,
// then `level_at` lays the head over the clothes over the neck over the screen.

const { HEAD, NONE, smooth } = run_board_theme_codec_face_shapes

const SQUARED = 2

interface Spot {
	face: Face
	x: number
	y: number
	ax: number
	nx: number
}

function within(value: number, low: number, high: number): boolean {
	return value > low && value < high
}

const HAIR = { above: 0.02, side_in: 0.07, side_out: 0.04, fringe: 0.05 }

function is_cap(face: Face, x: number, y: number): boolean {
	const top = HEAD.cy - HAIR.above
	const span = top - face.hair_top
	const reach = face.hair_width * Math.sqrt(Math.max(0, 1 - ((y - top) / span) ** SQUARED))

	return y < top && Math.abs(x) < reach
}

function is_side_hair(face: Face, x: number, y: number, half: number): boolean {
	const ax = Math.abs(x)

	return (
		y >= HEAD.cy - HAIR.above &&
		y < face.side_hair &&
		within(ax, half - HAIR.side_in, half + HAIR.side_out)
	)
}

function is_fringe(face: Face, x: number, y: number, half: number): boolean {
	return y < face.hairline(x) || Math.abs(x) > half - HAIR.fringe
}

function hair_level(face: Face, x: number, y: number, half: number): number {
	const is_hair =
		is_side_hair(face, x, y, half) || (is_cap(face, x, y) && is_fringe(face, x, y, half))

	if (!is_hair) return NONE

	return face.hair(x, y, half > 0 ? x / half : 0)
}

const EAR = { gap: 0.01, w: 0.055, lift: 0.02, h: 0.11, shade: 0.2, far: 0.22 }

// An ear either side, lit on the left.
function ear_level(face: Face, x: number, y: number): number {
	const across = ((Math.abs(x) - HEAD.rx - EAR.gap) / EAR.w) ** SQUARED
	const down = ((y + EAR.lift) / EAR.h) ** SQUARED

	if (across + down >= 1) return NONE

	return face.skin - EAR.shade - (x > 0 ? EAR.far : 0)
}

const BROW = { y: -0.152, slope: 0.055, from: 0.09, run: 0.31, inner: 0.08, outer: 0.41 }

function brow_line(ax: number): number {
	return BROW.y - BROW.slope * ((ax - BROW.from) / BROW.run)
}

const EYE = { x: 0.24, w: 0.1, lid_y: 0.055, lid_h: 0.016, lid: 0.42, h: 0.04, taper: 0.55 }
const IRIS = { y: 0.075, upper: 0.3, lid: 0.05, iris_w: 0.42, iris: 0.08, white: 0.86 }

// A blink leaves the lid's line.
function lid_level(face: Face, y: number): number {
	return Math.abs(y + EYE.lid_y) < EYE.lid_h ? face.skin - EYE.lid : NONE
}

// An open eye is a dark lid over a lit white and a dark iris.
function open_eye_level(along: number, y: number): number {
	const height = EYE.h * (1 - EYE.taper * along * along)

	if (Math.abs(y + IRIS.y) >= height) return NONE
	if (y < -IRIS.y - height * IRIS.upper) return IRIS.lid

	return Math.abs(along) < IRIS.iris_w ? IRIS.iris : IRIS.white
}

function eye_level(face: Face, ax: number, y: number, look: Look): number {
	const along = (ax - EYE.x) / EYE.w

	if (Math.abs(along) >= 1) return NONE

	return look.is_blink ? lid_level(face, y) : open_eye_level(along, y)
}

const MOUTH = { open_w: 0.12, top: 0.345, bottom: 0.445, open: 0.03, w: 0.17, y: 0.37 }
const LIPS = { tilt: 0.04, h: 0.02, level: 0.16 }

function is_open_mouth(ax: number, y: number, look: Look): boolean {
	return look.is_open && ax < MOUTH.open_w && within(y, MOUTH.top, MOUTH.bottom)
}

function mouth_level(ax: number, y: number, look: Look): number {
	if (is_open_mouth(ax, y, look)) return MOUTH.open

	return ax < MOUTH.w && Math.abs(y - MOUTH.y - LIPS.tilt * ax) < LIPS.h ? LIPS.level : NONE
}

// The skin's light: from the upper left, the far cheek and the hollows in shadow. Each adjustment
// is added in the demo's order, so the sums round as the demo's do.
const LIGHT = { side: 0.36, side_from: -0.05, side_to: 0.9, rim: 0.12, rim_from: 0.72 }
const BROW_LIT = { top: -0.47, bottom: -0.24, lift: 0.08, from: 0.1, to: -0.5 }
const HAIRLINE = { below: 0.05, shade: 0.12 }
const HOLLOW = { top: 0.1, bottom: 0.44, from: 0.55, to: 0.85, fade_from: 0.1, fade_to: 0.2 }

function base_light(spot: Spot): number {
	const { face, nx } = spot

	return (
		face.skin -
		LIGHT.side * smooth(LIGHT.side_from, LIGHT.side_to, nx) -
		LIGHT.rim * smooth(LIGHT.rim_from, 1, Math.abs(nx))
	)
}

function brow_lift(spot: Spot): number {
	return within(spot.y, BROW_LIT.top, BROW_LIT.bottom)
		? BROW_LIT.lift * smooth(BROW_LIT.from, BROW_LIT.to, spot.nx)
		: 0
}

function hairline_shade(spot: Spot): number {
	return spot.y < spot.face.hairline(spot.x) + HAIRLINE.below ? -HAIRLINE.shade : 0
}

function cheek_hollow(spot: Spot): number {
	const { face, y, nx } = spot

	if (!within(y, HOLLOW.top, HOLLOW.bottom)) return 0

	return -(
		face.hollow *
		smooth(HOLLOW.from, HOLLOW.to, Math.abs(nx)) *
		smooth(HOLLOW.fade_from, HOLLOW.fade_to, y)
	)
}

const run_board_theme_codec_face_head = {
	base_light,
	brow_line,
	brow_lift,
	cheek_hollow,
	ear_level,
	eye_level,
	hair_level,
	hairline_shade,
	mouth_level,
	within,
	BROW,
}

export { run_board_theme_codec_face_head }
export type { Spot }
