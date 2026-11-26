import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { BannerPlace, BigLook, Grid, Point } from './run-board-theme-host-types'

// The theme host's big type (joshuafolkken/kit#8917), ported from the confirmed theme demo: three-row
// letters for a banner in a borrowed header block, and three-row digits three cells wide.

const { code_points, put } = run_board_theme_host_grid

type Glyph = [string, string, string]

const GLYPH_HEIGHT = 3
const GLYPH_ROWS = Array.from({ length: GLYPH_HEIGHT }, (_, row) => row)
const HALF = 2
const POINT_STEP = 2
const DIGIT_STEP = 4

const BIG: ReadonlyMap<string, Glyph> = new Map<string, Glyph>([
	['A', ['▄▀▄', '█▀█', '▀ ▀']],
	['L', ['█  ', '█  ', '▀▀▀']],
	['E', ['█▀▀', '█▀ ', '▀▀▀']],
	['R', ['█▀▄', '█▀▄', '▀ ▀']],
	['T', ['▀█▀', ' █ ', ' ▀ ']],
	['M', ['█▄█', '█▀█', '▀ ▀']],
	['G', ['█▀▀', '█ █', '▀▀▀']],
	['N', ['█▀█', '█ █', '▀ ▀']],
	['C', ['█▀▀', '█  ', '▀▀▀']],
	['Y', ['█ █', ' █ ', ' ▀ ']],
	['!', ['█', '█', '▄']],
	[' ', [' ', ' ', ' ']],
])

// The point is one cell.
const DIGITS: ReadonlyMap<string, Glyph> = new Map<string, Glyph>([
	['0', ['┏━┓', '┃ ┃', '┗━┛']],
	['1', ['  ╻', '  ┃', '  ╹']],
	['2', ['╺━┓', '┏━┛', '┗━╸']],
	['3', ['╺━┓', ' ━┫', '╺━┛']],
	['4', ['╻ ╻', '┗━┫', '  ╹']],
	['5', ['┏━╸', '┗━┓', '╺━┛']],
	['6', ['┏━╸', '┣━┓', '┗━┛']],
	['7', ['╺━┓', '  ┃', '  ╹']],
	['8', ['┏━┓', '┣━┫', '┗━┛']],
	['9', ['┏━┓', '┗━┫', '╺━┛']],
	['.', [' ', ' ', '●']],
])

const BLOCKS = ' ▁▂▃▄▅▆▇█'

function glyph_row(table: ReadonlyMap<string, Glyph>, ch: string, row: number): string {
	return table.get(ch)?.[row] ?? ''
}

// A banner centered in `place`, its three rows from row `place.top`.
function banner(grid: Grid, place: BannerPlace, text: string, style: string): void {
	const top = place.top ?? 0

	for (const row of GLYPH_ROWS) {
		const line = code_points(text)
			.map((ch) => glyph_row(BIG, ch, row))
			.join(' ')
		const x = place.x + Math.floor((place.w - line.length) / HALF)

		put(grid, { y: top + row, x }, line, style)
	}
}

function step_of(ch: string): number {
	return ch === '.' ? POINT_STEP : DIGIT_STEP
}

function big_width(text: string): number {
	let sum = 0

	for (const ch of text) sum += step_of(ch)

	return sum - 1
}

function big_digit_row(grid: Grid, at: Point, part: string, style: string): void {
	for (const [index, piece] of code_points(part).entries()) {
		if (piece !== ' ') put(grid, { y: at.y, x: at.x + index }, piece, style)
	}
}

// One digit at `at`: its unlit segments in `look.ghost` first (an eight, or the point), when given.
function big_digit(grid: Grid, at: Point, ch: string, look: BigLook): void {
	const ghost = ch === '.' ? '.' : '8'

	for (const row of GLYPH_ROWS) {
		const place = { y: at.y + row, x: at.x }

		if (look.ghost) put(grid, place, glyph_row(DIGITS, ghost, row), look.ghost)
		big_digit_row(grid, place, glyph_row(DIGITS, ch, row), look.style)
	}
}

function big_number(grid: Grid, at: Point, text: string, look: BigLook): void {
	let { x } = at

	for (const ch of text) {
		big_digit(grid, { y: at.y, x }, ch, look)
		x += step_of(ch)
	}
}

const run_board_theme_host_fonts = { BLOCKS, banner, big_digit, big_number, big_width }

export { run_board_theme_host_fonts }
