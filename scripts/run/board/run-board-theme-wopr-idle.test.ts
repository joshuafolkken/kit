import { describe, expect, it } from 'vitest'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Grid } from './run-board-theme-host-types'
import { run_board_theme_wopr_data } from './run-board-theme-wopr-data'
import { run_board_theme_wopr_fixture } from './run-board-theme-wopr-fixture'
import { run_board_theme_wopr_idle } from './run-board-theme-wopr-idle'

const { HOST, WOPR, board_grid, cell_of, row_text, state_at } = run_board_theme_wopr_fixture
const { crack_row, draw_codes, draw_defcon, draw_lamps, draw_sweep, is_lit, out_ink } =
	run_board_theme_wopr_idle
const { progress_strip, rest_roles } = run_board_theme_wopr_idle
const { SHADES } = run_board_theme_wopr_data
const { set_cell } = run_board_theme_host_grid
const STEP_MS = 80
const WATCHED_MS = 20_000
const SAMPLE_MS = 10
// A style's color as 'r;g;b'.
const COLOR = /\[38;2;(\d+;\d+;\d+)m/u
// The demo's now line starts typing at tick 10; two ticks before it is through, two letters hold.
const LAST_TYPING = 10 + state_at('p', 10).progress.total - 2

// The times lamp 1 of group 3 turns on or off, sampled every `SAMPLE_MS`.
function changes_of(is_burst: boolean): Array<number> {
	const times = Array.from({ length: WATCHED_MS / SAMPLE_MS }, (_, step) => (step + 1) * SAMPLE_MS)

	return times.filter((ms) => is_lit(ms, 3, 1, is_burst) !== is_lit(ms - SAMPLE_MS, 3, 1, is_burst))
}

// Every lamp of the idle board at `tick`, by its row and the style it is drawn in.
function lamp_styles(tick: number): Array<{ row: number; style: string }> {
	const grid = board_grid()
	const { x, count, top } = WOPR.lamps

	draw_lamps(WOPR, grid, state_at('i', tick), tick)

	return Array.from({ length: SHADES.length * count }, (_, lamp) => {
		const [row, index] = [Math.floor(lamp / count), lamp % count]

		return { row, style: cell_of(grid, { y: top + row, x: x + 2 * index })[1] }
	})
}

// The characters the rules' dashes run as code at `tick` of the demo's ROW.
function rule_code(tick: number): Array<string> {
	const base = board_grid()
	const grid = board_grid()

	draw_codes(WOPR, grid, state_at('r', tick), tick)

	return WOPR.rule_cells
		.filter((cell) => cell_of(base, cell)[0] === '-')
		.map((cell) => cell_of(grid, cell)[0])
}

// The PROGRESS strip's three letters at `tick` of the demo's PROGRESS.
function strip_at(tick: number): string {
	const grid = board_grid()

	progress_strip(WOPR, grid, state_at('p', tick), tick)

	return row_text(grid, HOST.layout.level_spot.y).slice(WOPR.strip_x, WOPR.strip_x + 3)
}

describe('run_board_theme_wopr_idle', () => {
	it('lights a lamp the same way for the same step', () => {
		expect(is_lit(800, 3, 1, false)).toBe(is_lit(820, 3, 1, false))
	})

	it('draws a lamp every other column from the lamp panel’s left', () => {
		const grid = board_grid()

		draw_lamps(WOPR, grid, state_at('i', 50), 50)

		expect(grid[WOPR.lamps.top]?.[WOPR.lamps.x]?.[0]).toBe('■')
	})

	it('runs the sweep a cell a tick', () => {
		const grid = board_grid()

		draw_sweep(WOPR, grid, 3)

		expect(row_text(grid, WOPR.sweep.y).indexOf('■')).toBe(WOPR.sweep.left + 3)
	})
})

describe('run_board_theme_wopr_idle — the rules, DEFCON and the lane', () => {
	it('writes DEFCON with the level bracketed', () => {
		const grid = board_grid()
		const { level_spot } = HOST.layout

		draw_defcon(WOPR, grid, state_at('r', 12), 12)

		expect(row_text(grid, level_spot.y).slice(level_spot.x - 1)).toContain('DEFCON 5 [4] 3 2 1')
	})

	it('runs launch code on the rules while a lane types', () => {
		const grid = board_grid()
		const [first = { y: 0, x: 0 }] = WOPR.rule_cells

		draw_codes(WOPR, grid, state_at('r', 12), 12)

		expect(cell_of(grid, first)[0]).not.toBe('-')
	})

	it('cracks the lane in white during ROW', () => {
		const grid = board_grid()
		const state = state_at('r', 14)
		const { row } = HOST.layout

		crack_row(WOPR, grid, state, 14)

		expect(cell_of(grid, { y: row.y, x: row.x + state.row.length - 1 })[1]).toContain('255;255;255')
	})

	it('locks P and E of CPE beside DEFCON before the now line ends', () => {
		expect(strip_at(LAST_TYPING)).toMatch(/^.PE$/u)
	})
})

// joshuafolkken/kit#9137: the lamps keep kit's rows and pace; a red row's out lamp is a red halved.
describe('run_board_theme_wopr_idle — the lamps', () => {
	it('changes a lamp on kit’s step, calm or bursting', () => {
		const calm = changes_of(false)
		const burst = changes_of(true)

		expect(calm.length).toBeGreaterThan(0)
		expect(burst.length).toBeGreaterThan(calm.length)
		expect([...calm, ...burst].every((ms) => ms % STEP_MS === 0)).toBe(true)
	})

	it('puts a yellow row’s lamp out in yellow halved and a red row’s in red halved', () => {
		const outs = SHADES.map((_, row) => out_ink(row))

		expect(outs.map((out) => COLOR.exec(out)?.[1])).toStrictEqual(
			['yellow', 'yellow', 'yellow', 'red', 'red', 'yellow', 'red'].map((shade) =>
				shade === 'yellow' ? '128;107;5' : '128;38;40',
			),
		)
		expect(outs.every((out) => out.startsWith('\u{1B}[2m'))).toBe(true)
	})

	it('draws every lamp lit or out in its row’s shade', () => {
		const drawn = [50, 55, 60, 65, 70].flatMap((tick) => lamp_styles(tick))
		const strays = drawn.filter(
			({ row, style }) => !Object.values(SHADES[row] ?? {}).includes(style),
		)

		expect(strays).toStrictEqual([])
		expect(new Set(drawn.map(({ style }) => style)).size).toBe(4)
	})
})

// joshuafolkken/kit#9137: code not yet locked changes on every tick.
describe('run_board_theme_wopr_idle — code on every tick', () => {
	it('changes every rule cell running code from one tick to the next', () => {
		const kept = [12, 13, 14, 15].flatMap((tick) => {
			const next = rule_code(tick + 1)

			return rule_code(tick).filter((ch, index) => ch === next[index])
		})

		expect(rule_code(12).length).toBeGreaterThan(0)
		expect(kept).toStrictEqual([])
	})

	it('changes the strip’s unlocked letters every tick and holds the locked ones', () => {
		const [first = '', second = ''] = [strip_at(11), strip_at(12)]
		const kept = [...first].filter((ch, index) => ch === second.charAt(index))

		expect(kept).toStrictEqual([])
		expect(strip_at(LAST_TYPING - 1).slice(1)).toBe(strip_at(LAST_TYPING).slice(1))
		expect(strip_at(LAST_TYPING - 1).charAt(0)).not.toBe(strip_at(LAST_TYPING).charAt(0))
	})
})

// joshuafolkken/kit#9137: text at rest takes the theme's roles over the host's body.
const [{ y: RULE_Y } = { y: 0 }] = WOPR.rule_cells
const OFF_RULE_Y = RULE_Y - 1

// A board of blanks with `cells` set on it, its text given its roles at rest.
function rest_of(cells: ReadonlyArray<[y: number, x: number, ch: string, style: string]>): Grid {
	const grid: Grid = Array.from({ length: RULE_Y + 1 }, () => [])

	for (const [y, x, ch, style] of cells) set_cell(grid, { y, x }, [ch, style])
	rest_roles(WOPR, grid)

	return grid
}

describe('run_board_theme_wopr_idle.rest_roles', () => {
	it('styles a body digit as num on any row', () => {
		const grid = rest_of([
			[OFF_RULE_Y, 0, '7', 'body'],
			[RULE_Y, 0, '4', 'body'],
		])
		const styles = [OFF_RULE_Y, RULE_Y].map((y) => cell_of(grid, { y, x: 0 })[1])

		expect(styles).toStrictEqual(['num', 'num'])
	})

	it('styles a body letter as head on a rule row only', () => {
		const grid = rest_of([
			[OFF_RULE_Y, 0, 'a', 'body'],
			[RULE_Y, 0, 'A', 'body'],
		])

		expect(cell_of(grid, { y: OFF_RULE_Y, x: 0 })[1]).toBe('body')
		expect(cell_of(grid, { y: RULE_Y, x: 0 })[1]).toBe('head')
	})

	it('leaves blanks and cells in any other style as they are', () => {
		const kept: Grid[number] = [
			[' ', 'body'],
			['-', 'rule'],
			['9', 'ok'],
			['B', 'body:dim'],
		]
		const grid = rest_of(kept.map(([ch, style], x) => [RULE_Y, x, ch, style]))

		expect(grid[RULE_Y]).toStrictEqual(kept)
	})
})

describe('run_board_theme_wopr_idle.rest_roles — the demo board', () => {
	it('styles the demo board’s rule heading as head and keeps its dashes', () => {
		const grid = board_grid()
		const text = row_text(grid, RULE_Y)
		const word = text.search(/[a-z]/iu)

		rest_roles(WOPR, grid)

		expect(cell_of(grid, { y: RULE_Y, x: word })[1]).toBe('head')
		expect(cell_of(grid, { y: RULE_Y, x: text.indexOf('-') })[1]).toBe('rule')
	})
})
