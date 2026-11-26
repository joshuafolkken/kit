// The codec theme's portraits as shapes (joshuafolkken/kit#8917), a verbatim port of the confirmed
// theme demo's `fixed-v22-codec-faces.mjs` faces — a commander and an operative described by
// formulas, sampled to an image by `run-board-theme-codec-face-cells.ts`. Coordinates run -1..1
// across the portrait, y downward; a level runs 0 (dark) to 1 (bright), -1 where a shape does not
// reach.

const NONE = -1
const SMOOTH = { cubic: 3, square: 2 }
const SQUARED = 2

// How a portrait looks this tick: the mouth open, the eyes shut.
interface Look {
	is_open: boolean
	is_blink: boolean
}

type Clothes = (x: number, y: number) => number

// What tells the two faces apart.
interface Face {
	skin: number
	jaw: number
	jaw_power: number
	brow: number
	brow_level: number
	hollow: number
	neck: number
	hair_width: number
	hair_top: number
	hairline: (x: number) => number
	side_hair: number
	hair: (x: number, y: number, nx: number) => number
	stubble: number
	fold: number
	clothes: Clothes
}

function clamp(value: number): number {
	return Math.min(1, Math.max(0, value))
}

function smooth(from: number, to: number, value: number): number {
	const t = clamp((value - from) / (to - from))

	return t * t * (SMOOTH.cubic - SMOOTH.square * t)
}

const HEAD = { cy: -0.1, rx: 0.5, ry: 0.62, chin: 0.58 }

// Half the head's width at a height: an ellipse above the eyes, a squared curve down to the chin.
function half_width(face: Face, y: number): number {
	if (y < HEAD.cy) return HEAD.rx * Math.sqrt(Math.max(0, 1 - ((y - HEAD.cy) / HEAD.ry) ** SQUARED))
	const t = (y - HEAD.cy) / (HEAD.chin - HEAD.cy)

	return t >= 1 ? 0 : HEAD.rx * (1 - t ** face.jaw_power) ** face.jaw
}

// The commander's shirt collar and tie: the tie, the shirt's V, then the jacket with a lit lapel
// edge.
const SUIT = { neck: 0.62, neck_curve: 0.17, curve_power: 1.5, tie_top: 0.68, tie_w: 0.045 }
const SHIRT = { tie_flare: 0.05, tie: 0.3, v_w: 0.3, v_slope: 0.62, shirt: 0.92, shade: 0.2 }
const LAPEL = { shirt_to: 0.3, w: 0.05, lapel: 0.62, jacket: 0.3, shade: 0.1, from: -0.2, to: 0.8 }

function is_tie(ax: number, y: number): boolean {
	return y > SUIT.tie_top && ax < SUIT.tie_w + SHIRT.tie_flare * (y - SUIT.tie_top)
}

// Below the tie: the shirt's V, the lit lapel edge, then the jacket.
function shirt_level(x: number, ax: number, y: number): number {
	const v_edge = SHIRT.v_w - (y - SUIT.neck) * SHIRT.v_slope

	if (ax < v_edge) return SHIRT.shirt - SHIRT.shade * smooth(0, LAPEL.shirt_to, x)
	if (ax < v_edge + LAPEL.w) return LAPEL.lapel

	return LAPEL.jacket - LAPEL.shade * smooth(LAPEL.from, LAPEL.to, x)
}

function commander_clothes(x: number, y: number): number {
	const ax = Math.abs(x)

	if (y < SUIT.neck + SUIT.neck_curve * ax ** SUIT.curve_power) return NONE
	if (is_tie(ax, y)) return SHIRT.tie

	return shirt_level(x, ax, y)
}

// The operative's high collar round the neck, then the suit with a strap seam.
const COLLAR = { w: 0.3, top: 0.56, bottom: 0.72, fold: 0.6, lit: 0.5, base: 0.3, shade: 0.1 }
const COLLAR_LIGHT = { from: -0.2, to: 0.3 }
const SNEAK = { neck: 0.66, neck_curve: 0.15, curve_power: 1.5 }
const STRAP = { x: 0.46, slope: 0.2, top: 0.7, w: 0.03, strap: 0.42 }
const SNEAK_SUIT = { base: 0.2, shade: 0.07, from: -0.2, to: 0.8 }

function collar_level(x: number, y: number): number {
	if (y < COLLAR.fold) return COLLAR.lit

	return COLLAR.base - COLLAR.shade * smooth(COLLAR_LIGHT.from, COLLAR_LIGHT.to, x)
}

function is_collar(ax: number, y: number): boolean {
	return ax < COLLAR.w && y > COLLAR.top && y < COLLAR.bottom
}

function operative_clothes(x: number, y: number): number {
	const ax = Math.abs(x)

	if (is_collar(ax, y)) return collar_level(x, y)
	if (y < SNEAK.neck + SNEAK.neck_curve * ax ** SNEAK.curve_power) return NONE
	if (Math.abs(ax - STRAP.x - STRAP.slope * (y - STRAP.top)) < STRAP.w) return STRAP.strap

	return SNEAK_SUIT.base - SNEAK_SUIT.shade * smooth(SNEAK_SUIT.from, SNEAK_SUIT.to, x)
}

// The commander's silver hair swept back: a waved hairline, lit streaks fading to the far side.
const SWEPT = { line: -0.43, wave: 0.07, wave_rate: 6 }
const STREAK = { base: 0.3, lit: 0.55, from: 0.35, to: 0.95, rate_x: 22, rate_y: 7 }
const STREAK_FADE = { from: 1, to: -0.2, far: 0.1 }

function commander_hairline(x: number): number {
	return SWEPT.line - SWEPT.wave * Math.cos(x * SWEPT.wave_rate)
}

function commander_hair(x: number, y: number, nx: number): number {
	const streak = smooth(STREAK.from, STREAK.to, Math.sin(x * STREAK.rate_x + y * STREAK.rate_y))

	return (
		STREAK.base +
		STREAK.lit * streak * smooth(STREAK_FADE.from, STREAK_FADE.to, nx) -
		STREAK_FADE.far * smooth(0, 1, nx)
	)
}

// The operative's dark hair in a ragged fringe: a sawtooth hairline, the hair grained, a lit lock
// on the near side.
const FRINGE = { line: -0.34, depth: 0.13, rate: 3.1, phase: 0.35, mid: 0.5 }
const GRAIN = { base: 0.2, grain: 0.09, rate_x: 31, rate_y: 13 }
const LOCK = { lit: 0.26, from: 0.5, rate_x: 3, rate_y: 7, phase: 2.2, near: 0.2, far: -0.5 }

function operative_hairline(x: number): number {
	const tooth = ((((x * FRINGE.rate + FRINGE.phase) % 1) + 1) % 1) - FRINGE.mid

	return FRINGE.line + FRINGE.depth * Math.abs(tooth)
}

function operative_hair(x: number, y: number, nx: number): number {
	const lock = smooth(LOCK.from, 1, Math.sin(x * LOCK.rate_x - y * LOCK.rate_y - LOCK.phase))

	return (
		GRAIN.base +
		GRAIN.grain * Math.sin(x * GRAIN.rate_x + y * GRAIN.rate_y) +
		LOCK.lit * lock * smooth(LOCK.near, LOCK.far, nx)
	)
}

const FACES: Readonly<Record<'commander' | 'operative', Face>> = {
	commander: {
		skin: 0.74,
		jaw: 0.4,
		jaw_power: 3.2,
		brow: 0.034,
		brow_level: 0.16,
		hollow: 0.17,
		neck: 0.27,
		hair_width: 0.54,
		hair_top: -0.8,
		hairline: commander_hairline,
		side_hair: 0.04,
		hair: commander_hair,
		stubble: 0,
		fold: 0.12,
		clothes: commander_clothes,
	},
	operative: {
		skin: 0.84,
		jaw: 0.52,
		jaw_power: 2.7,
		brow: 0.03,
		brow_level: 0.1,
		hollow: 0.1,
		neck: 0.23,
		hair_width: 0.6,
		hair_top: -0.86,
		hairline: operative_hairline,
		side_hair: 0.06,
		hair: operative_hair,
		stubble: 0.1,
		fold: 0,
		clothes: operative_clothes,
	},
}

const run_board_theme_codec_face_shapes = { FACES, HEAD, NONE, clamp, half_width, smooth }

export { run_board_theme_codec_face_shapes }
export type { Face, Look }
