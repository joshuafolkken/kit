import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_trace_data } from './run-board-theme-trace-data'

// MATRIX's paints and glyphs (joshuafolkken/kit#8917), from the confirmed theme demo: colors mixed
// between its shades, the drop painter's head and tail (run-board-rain-gradient.ts), and the glyph
// a cell of rain shows.

const { fg, mixed, pick } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { CELL_KEY, FLICKER_CELLS, GLYPHS, HEAD_RGB, SETTLED, SHADE, TAIL } =
	run_board_theme_trace_data

const FLICKER_SALT = 4

function paint(color: string): string {
	return fg(color)
}

// The color `t` of the way from `from` to `to` (the host's `mixed`), `t` held to 0..1.
function mix(from: string, to: string, t: number): string {
	return mixed(from, to, Math.min(1, Math.max(0, t)))
}

const HEAD_ON = paint(SHADE.head)
const BRIGHT_ON = paint(SHADE.bright)
const DARK_ON = paint(SHADE.dark)

// The three head cells, white to green, then a tail eased from bright to ember. The tail is held in
// five steps, so a trail cell's color changes only when it crosses a step, not on every step.
const TAIL_PAINTS: ReadonlyArray<string> = Array.from({ length: TAIL.steps + 1 }, (_, index) =>
	paint(mix(SHADE.ember, SHADE.bright, (1 - index / TAIL.steps) ** TAIL.ease)),
)
const HEAD_PAINTS: ReadonlyArray<string> = HEAD_RGB.map((color) => paint(color))
const HEAD_CELLS = HEAD_PAINTS.length

function paint_at(distance: number, trail: number): string {
	const head = HEAD_PAINTS[distance]

	if (head !== undefined) return head
	const t = (distance - HEAD_CELLS) / Math.max(1, trail - HEAD_CELLS)

	return TAIL_PAINTS[Math.min(TAIL.steps, Math.round(t * TAIL.steps))] ?? BRIGHT_ON
}

function glyph(seed: number): string {
	return pick(GLYPHS, seed)
}

// The glyph a trail cell keeps at its place.
function settled_glyph(x: number, y: number): string {
	return GLYPHS[(x * SETTLED.x + y * SETTLED.y) % GLYPHS.length] ?? ' '
}

// A lead cell takes a fresh glyph each frame; a trail cell keeps its place's settled glyph.
function glyph_at(x: number, y: number, distance: number, frame: number): string {
	if (distance < FLICKER_CELLS) return glyph(hash(x * CELL_KEY.x + y, frame, FLICKER_SALT))

	return settled_glyph(x, y)
}

const run_board_theme_trace_paint = {
	BRIGHT_ON,
	DARK_ON,
	HEAD_CELLS,
	HEAD_ON,
	HEAD_PAINTS,
	glyph,
	glyph_at,
	mix,
	paint,
	paint_at,
	settled_glyph,
}

export { run_board_theme_trace_paint }
