import type { Spot } from './run-board-spot'

// The header clocks' colons a live `run:board` blinks between redraws (joshuafolkken/kit#8476): lit for
// one half second, dark — not gone — for the next, lit again on the second the frame is redrawn on. A
// dark colon is its clock's 24-bit color at `DARK` of its brightness; a clock in a named color or the
// terminal's default — a terminal without 24-bit color, or the normal board's uncolored clocks — has
// no color to scale, so its colon takes the dim attribute.

const COLON_MS = 500
// Lit, then dark.
const PHASES = 2
// How bright a dark colon is against a lit one; a provisional value, looked at live.
const DARK = 0.3
const COLON = ':'
const CSI = '\u{1B}['
const RESET = `${CSI}0m`
const DIM = `${CSI}2m`
const RGB_PARTS = 3
// The foreground a spot's style leaves in effect: a 24-bit color, or a reset or named color that
// leaves none to scale.
// eslint-disable-next-line no-control-regex -- the color escapes a spot keeps are control characters
const FOREGROUND = /38;2;(\d+);(\d+);(\d+)|\u{1B}\[(?:0|39|3[0-7]|9[0-7])?m/gu

// Whether a colon is lit at `now_ms`: the first half of every second.
function is_lit(now_ms: number): boolean {
	return Math.floor(now_ms / COLON_MS) % PHASES === 0
}

// The 24-bit color in effect at the end of `style`, if one is.
function rgb_of(style: string): Array<number> | undefined {
	const last = [...style.matchAll(FOREGROUND)].at(-1)

	if (last?.[1] === undefined) return undefined

	return last.slice(1, 1 + RGB_PARTS).map(Number)
}

// The style a dark colon is drawn in: its color scaled down, or the dim attribute where there is none.
function dark_style(style: string): string {
	const rgb = rgb_of(style)

	if (rgb === undefined) return `${style}${DIM}`
	const dark = rgb.map((part) => String(Math.round(part * DARK)))

	return `${style}${CSI}38;2;${dark.join(';')}m`
}

// Every colon written lit or dark as `now_ms` has it: the cursor moved there, its style, `:`, a reset.
function colon_bytes(colons: ReadonlyArray<Spot>, now_ms: number): string {
	const is_now_lit = is_lit(now_ms)

	return colons
		.map((spot) => {
			const style = is_now_lit ? spot.style : dark_style(spot.style)

			return `${CSI}${String(spot.row)};${String(spot.column)}H${style}${COLON}${RESET}`
		})
		.join('')
}

// The next half second the colons turn on, or never where the frame has none.
function colon_boundary(colons: ReadonlyArray<Spot>, now_ms: number): number {
	if (colons.length === 0) return Infinity

	return now_ms - (now_ms % COLON_MS) + COLON_MS
}

const run_board_colon = { COLON_MS, colon_boundary, colon_bytes, dark_style, is_lit }

export { run_board_colon }
