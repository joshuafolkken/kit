import { run_board_theme_flux_data, type Rgb } from './run-board-theme-flux-data'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import type { Cell, Grid, Point } from './run-board-theme-host-types'

// The BTTF theme's colors at work (joshuafolkken/kit#8917): mixing, painting and reading back a cell's
// look, ported from the confirmed theme demo's `fixed-v21-theme-bttf.mjs`.

const { ARC, BLACK, BODY, DIM, ROLES, text_of } = run_board_theme_flux_data
const { ESC, bg, fg } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash

const FG_OF = /38;2;(?<r>\d+);(?<g>\d+);(?<b>\d+)/u
const BG_OF = /48;2;(?<r>\d+);(?<g>\d+);(?<b>\d+)/u
const NOISE_SALT = 7919
const CHANCE_BORN = 100_000
const CHANCE_SALT = 31
const HEAD_SHARE = 0.35
const OLD_SHARE = 0.15
// A role style's parts: the role and its attribute ('rule:dim').
const ROLE_PARTS = 2

// A cell's look as colors: its foreground and its ground (none when undefined).
interface Look {
	f: Rgb
	b: Rgb | undefined
}

function mix(from: Rgb, to: Rgb, share: number): Rgb {
	const k = Math.min(1, Math.max(0, share))

	return {
		r: Math.round(from.r + (to.r - from.r) * k),
		g: Math.round(from.g + (to.g - from.g) * k),
		b: Math.round(from.b + (to.b - from.b) * k),
	}
}

function scaled(color: Rgb, share: number): Rgb {
	return mix(BLACK, color, share)
}

function paint(color: Rgb, back?: Rgb): string {
	return `${fg(text_of(color))}${back ? bg(text_of(back)) : ''}`
}

// The bolts' heads' grounds: a fresh head and one a tick old.
const HEAD_BACK = scaled(ARC, HEAD_SHARE)
const OLD_BACK = scaled(ARC, OLD_SHARE)

function rgb_of(found: RegExpExecArray | null): Rgb | undefined {
	const groups = found?.groups

	if (!groups) return undefined

	return { r: Number(groups['r']), g: Number(groups['g']), b: Number(groups['b']) }
}

// A cell's look as colors: its foreground and its ground, from a raw style or a role.
function raw_look(style: string): Look {
	return { f: rgb_of(FG_OF.exec(style)) ?? BODY, b: rgb_of(BG_OF.exec(style)) }
}

function role_look(style: string): Look {
	const [role = '', attribute] = style.split(':', ROLE_PARTS)
	const color = ROLES.get(role) ?? BODY

	return { f: attribute === 'dim' ? scaled(color, DIM) : color, b: undefined }
}

function look_of(style: string): Look {
	return style.startsWith(ESC) ? raw_look(style) : role_look(style)
}

function is_blank([ch, style]: Cell): boolean {
	return ch === ' ' && !BG_OF.test(style)
}

// The cell at `at` takes the look `to` makes of its own; a cell off the grid is left alone.
function recolor(grid: Grid, at: Point, to: (look: Look) => Look): void {
	const row = grid[at.y]
	const cell = row?.[at.x]

	if (!row || !cell) return
	const next = to(look_of(cell[1]))

	row[at.x] = [cell[0], paint(next.f, next.b)]
}

// A stable number in 0..1 (the demos' `noise` and `Math.random`, made deterministic).
function noise(x: number, y: number, salt = 0): number {
	return hash(x, y, salt + NOISE_SALT)
}

// A bolt's dice: the same for the same tick it was born on, index and salt.
function chance(born: number, index: number, salt: number): number {
	return hash(born + CHANCE_BORN, index, salt + CHANCE_SALT)
}

const run_board_theme_flux_paint = {
	HEAD_BACK,
	OLD_BACK,
	chance,
	is_blank,
	look_of,
	mix,
	noise,
	paint,
	recolor,
	scaled,
}

export { run_board_theme_flux_paint }
export type { Look }
