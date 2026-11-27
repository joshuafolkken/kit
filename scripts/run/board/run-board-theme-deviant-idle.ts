import { run_board_theme_deviant_data } from './run-board-theme-deviant-data'
import { run_board_theme_deviant_notice } from './run-board-theme-deviant-notice'
import { run_board_theme_deviant_parts } from './run-board-theme-deviant-parts'
import { run_board_theme_deviant_rules } from './run-board-theme-deviant-rules'
import { run_board_theme_deviant_watch } from './run-board-theme-deviant-watch'
import type { ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import type { Cell, Point, ThemeLayout } from './run-board-theme-host-types'

// The deviant theme's quiet idle effects over the whole board, timed on the scan band's eight-second
// cycle so no two start together. The scan band: a faint blue wash passes down the board in the
// cycle's last second. The rule glints: twice a cycle a short bright segment runs left to right
// along every rule, the rules taking turns from the top, in color alone; headings are left alone.
// The instability glitch: once a cycle one letter of the board's data is another glyph for a few
// ticks, as the wall's order text glitches.

const { is_rule, pick, set_cell } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { RGB, SCAN } = run_board_theme_deviant_data
const { ORDER } = run_board_theme_deviant_notice
const { bold, ink, mix } = run_board_theme_deviant_parts
const { is_rule_row } = run_board_theme_deviant_rules
const { open_rows, row_limit } = run_board_theme_deviant_watch

// The glints: the ticks into the band's cycle their two runs start on, the ticks one takes to cross
// a rule, the ticks from one rule's start to the next's, the segment's length, and its head's glow.
const GLINT = { first: 15, second: 80, cross: 30, stagger: 3, w: 6, glow: 0.45 }
// The glitch: the tick into the band's cycle it lands on and the ticks it stays.
const GLITCH = { at: 45, ticks: 3, row_salt: 93, cell_salt: 94, glyph_salt: 95 }
const LETTER = /^[A-Za-z]$/u

// The row the scan band's middle is on at `tick`; none while it is not passing.
function scan_band(layout: ThemeLayout, tick: number): number | undefined {
	const phase = (tick % SCAN.every) - (SCAN.every - SCAN.ticks)

	if (phase < 0) return undefined

	return (phase / SCAN.ticks) * (layout.h + SCAN.reach) - SCAN.reach
}

// How much of the scan band lies on row `y`: full on its middle row, falling off over its reach.
function scan_tint(layout: ThemeLayout, y: number, tick: number): number {
	const band = scan_band(layout, tick)

	return band === undefined ? 0 : Math.max(0, 1 - Math.abs(y - band) / SCAN.reach)
}

// A glint's style `back` cells behind its head: brightest at the head, fading to the rule's color.
function glint_ink(back: number): string {
	if (back === 0) return bold(mix(RGB.blue, RGB.white, GLINT.glow))

	return ink(mix(RGB.blue, RGB.steel, back / GLINT.w))
}

// A rule's cell under the glint, recolored; any other cell is left as it is.
function glint_cell(row: Array<Cell> | undefined, x: number, back: number): void {
	const cell = row?.[x]

	if (row && cell && is_rule(cell)) row[x] = [cell[0], glint_ink(back)]
}

// One rule's glint `since` ticks after its turn came: a short segment on the rule's own cells.
function glint(draw: ThemeDraw, y: number, since: number): void {
	if (since < 0 || since >= GLINT.cross) return
	const head = Math.round((since / GLINT.cross) * (draw.api.layout.edge + GLINT.w))

	for (let back = 0; back < GLINT.w; back++) glint_cell(draw.grid[y], head - back, back)
}

// The glints along every rule, top to bottom a few ticks apart; none while the scan band passes.
function rule_glints(draw: ThemeDraw): void {
	const { api, grid, tick } = draw
	const phase = tick % SCAN.every

	if (scan_band(api.layout, tick) !== undefined) return
	const since = phase - (phase >= GLINT.second ? GLINT.second : GLINT.first)
	const rows = [...grid.keys()].filter((y) => is_rule_row(grid, y))

	for (const [index, y] of rows.entries()) glint(draw, y, since - index * GLINT.stagger)
}

// The letter this cycle's glitch lands on: one of a data row's own, never under the panel.
function glitch_spot(draw: ThemeDraw, cycle: number): Point | undefined {
	const rows = open_rows(draw)

	if (rows.length === 0) return undefined
	const y = pick(rows, hash(cycle, GLITCH.row_salt))
	const limit = row_limit(draw.api.layout, y)
	const row = draw.grid[y] ?? []
	const letters = [...row.keys()].filter((x) => x < limit && LETTER.test(row[x]?.[0] ?? ''))

	return letters.length === 0 ? undefined : { y, x: pick(letters, hash(cycle, GLITCH.cell_salt)) }
}

// The instability glitch: once a cycle one letter of the board's data is another glyph, in the
// order's red-orange, for a few ticks; the board's own letter is back on the next frame.
function glitch(draw: ThemeDraw): void {
	const { grid, tick } = draw
	const since = (tick % SCAN.every) - GLITCH.at

	if (since < 0 || since >= GLITCH.ticks) return
	const cycle = Math.floor(tick / SCAN.every)
	const spot = glitch_spot(draw, cycle)

	if (spot === undefined) return
	set_cell(grid, spot, [pick(ORDER.glitch, hash(cycle, GLITCH.glyph_salt)), bold(RGB.order)])
}

const run_board_theme_deviant_idle = { glitch, rule_glints, scan_band, scan_tint }

export { run_board_theme_deviant_idle }
