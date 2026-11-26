import { run_board_theme_host_fonts } from './run-board-theme-host-fonts'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_parts } from './run-board-theme-host-parts'
import type { Grid, ThemePart } from './run-board-theme-host-types'
import {
	run_board_theme_magi_data,
	type MagiKit,
	type MagiPanel,
	type PanelLook,
} from './run-board-theme-magi-data'
import { run_board_theme_magi_draw } from './run-board-theme-magi-draw'

// The MAGI theme's opening (joshuafolkken/kit#8917), ported from the confirmed theme demo: system
// start-up on a dark screen. The title types; the three computers come up one by one in their
// triangle — the frame flickers on, a check bar fills, ONLINE — each with its check line beneath;
// the links light, ALL GREEN in tall letters; then the board unfolds from the middle row outward
// between two marching WARNING bands, and blooms once.

const { banner } = run_board_theme_host_fonts
const { BOLD, ESC, fg, pick, put, repeated, restyle } = run_board_theme_host_grid
const { eased } = run_board_theme_host_parts
const { AMBER, AMBER_BOLD, BLINK, GREEN, GREEN_ON, MAGI_OPEN, ORANGE, PALE_BOLD } =
	run_board_theme_magi_data
const { SPINNER, WHITE } = run_board_theme_magi_data
const { edge_band, is_lit, link_pair, magi_box } = run_board_theme_magi_draw

// A panel's frame flickers for its first ticks, then its check bar fills over the next, in cells.
const BOOT = { power: 4, fill: 10, cells: 8, width: 14, flash_gap: 2 }
// The title's row above the middle; the links' cells, the pulse's cycle and the label's offset.
const TITLE_UP = 10
const LINKS = { last: 23, cycle: 26, cells: 24, left: 4, right: 3, label: 3 }
// Each panel's check line: its row below the middle, its column, width and word's column.
const CHECK_LINE = { below: 5, x: 31, width: 22, word: 8 }
const GREEN_BELOW = 9
const HALF = 2
const LIGHT = '230;120;0'

function powering_look(age: number): PanelLook {
	return { text: '', frame: age % HALF === 1 ? LIGHT : '90;45;0', fill: ORANGE }
}

function boot_look(age: number, tick: number): PanelLook {
	if (age < BOOT.power) return powering_look(age)

	if (age < MAGI_OPEN.each) {
		const bar = repeated('▮', 1 + Math.floor(((age - BOOT.power) / BOOT.fill) * BOOT.cells))

		return { text: `CHECK ${bar}`.padEnd(BOOT.width), frame: LIGHT, fill: fg(AMBER) }
	}

	const is_flash = tick === MAGI_OPEN.green || tick === MAGI_OPEN.green + HALF

	return { text: 'ONLINE', frame: is_flash ? WHITE : '90;200;120', fill: GREEN }
}

function boot_links(kit: MagiKit, grid: Grid, tick: number): void {
	const { screen_cx, screen_cy } = kit.api.layout
	const y = screen_cy - 1

	put(grid, { y, x: screen_cx - LINKS.label }, ' MAGI ', AMBER_BOLD)
	if (tick < MAGI_OPEN.green) return
	// A pulse runs along each link in toward MAGI, as on the idle panel.
	const at = LINKS.last - ((tick - MAGI_OPEN.green) % LINKS.cycle)

	for (let step = 0; step < LINKS.cells; step++) {
		const xs = { left: screen_cx - LINKS.left - step, right: screen_cx + LINKS.right + step }

		link_pair(grid, y, xs, step === at || step === at + 1)
	}
}

// One computer coming up: its panel, and its check line — a spinner, then ONLINE.
function boot_panel(kit: MagiKit, grid: Grid, entry: [number, MagiPanel], tick: number): void {
	const [index, panel] = entry
	const age = tick - MAGI_OPEN.boot - MAGI_OPEN.each * index

	if (age < 0) return
	const { screen_cx, screen_cy } = kit.api.layout
	const y = screen_cy + CHECK_LINE.below + index
	const is_checking = age < MAGI_OPEN.each
	const word = is_checking ? pick(SPINNER, (tick % SPINNER.length) / SPINNER.length) : 'ONLINE'

	magi_box(grid, panel, boot_look(age, tick))
	put(
		grid,
		{ y, x: screen_cx - CHECK_LINE.x },
		`${panel.name} `.padEnd(CHECK_LINE.width, '.'),
		ORANGE,
	)
	put(grid, { y, x: screen_cx - CHECK_LINE.word }, word, is_checking ? PALE_BOLD : GREEN)
}

function magi_boot(kit: MagiKit, grid: Grid, tick: number): void {
	const { title } = MAGI_OPEN
	const { screen_cx, screen_cy } = kit.api.layout
	const typed = `${title.slice(0, tick + 1)}${tick < title.length ? '█' : ''}`
	const title_at = { y: screen_cy - TITLE_UP, x: screen_cx - Math.floor(title.length / HALF) }

	put(grid, title_at, typed, AMBER_BOLD)
	boot_links(kit, grid, tick)
	for (const entry of kit.boot_panels.entries()) boot_panel(kit, grid, entry, tick)
	if (tick < MAGI_OPEN.green) return
	const place = { x: 0, w: HALF * screen_cx, top: screen_cy + GREEN_BELOW }

	banner(grid, place, 'ALL GREEN', is_lit(tick, BLINK.slow) ? GREEN_ON : GREEN)
}

// One row of the board unfolding: the board within `half` rows of the middle, a band on the edge.
function unfold_row(
	kit: MagiKit,
	grid: Grid,
	board: Grid,
	at: { y: number; half: number; tick: number },
): void {
	const { y, half, tick } = at
	const off = Math.abs(y - kit.api.layout.screen_cy)
	const row = off < half ? board[y] : undefined

	if (row) {
		grid[y] = row

		return
	}

	if (off === half) edge_band(grid, kit.api.layout, y, tick)
}

// The board from the middle row out to `half` rows either side, a WARNING band on each edge.
function unfold(kit: MagiKit, grid: Grid, board: Grid, at: { half: number; tick: number }): void {
	for (let y = 0; y < kit.api.layout.h; y++) unfold_row(kit, grid, board, { y, ...at })
}

function opening_draw(kit: MagiKit, grid: Grid, tick: number): void {
	if (tick >= MAGI_OPEN.done) return

	if (tick >= MAGI_OPEN.bloom) {
		restyle(
			grid,
			([, style]) => !style.startsWith(ESC),
			() => `${fg('255;235;200')}${BOLD}`,
		)

		return
	}

	const board = grid.map((row) => [...row])

	kit.api.blank_screen(grid)
	magi_boot(kit, grid, tick)
	if (tick < MAGI_OPEN.unfold) return
	const share = (tick - MAGI_OPEN.unfold + 1) / (MAGI_OPEN.bloom - MAGI_OPEN.unfold)

	unfold(kit, grid, board, { half: Math.ceil(eased(share) * (kit.api.layout.h / HALF)), tick })
}

function magi_opening(kit: MagiKit): ThemePart {
	return {
		ticks: MAGI_OPEN.ticks,
		note: 'start-up: MELCHIOR, BALTHASAR, CASPER come up and check one by one · ALL GREEN · the board unfolds between WARNING bands',
		draw: (grid, tick) => {
			opening_draw(kit, grid, tick)
		},
	}
}

const run_board_theme_magi_opening = { boot_look, magi_opening }

export { run_board_theme_magi_opening }
