import { run_board_theme_deviant_data } from './run-board-theme-deviant-data'
import { run_board_theme_deviant_parts } from './run-board-theme-deviant-parts'
import { run_board_theme_draw, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Point, ThemeApi, ThemePart } from './run-board-theme-host-types'

// The deviant theme's ending: the board freezes grey under the mission stamp, typed two letters a
// tick; the board leaves in columns from the bottom up; the empty screen holds about a second.

const { put, repeated, restyle } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { BLANK, PAIR } = run_board_theme_draw
const { CLOSE, RGB } = run_board_theme_deviant_data
const { bold, ink, mix } = run_board_theme_deviant_parts
// How long the stamp types: until its last figure lands.
const STAMP_TYPED_MS = (CLOSE.full_after / CLOSE.pace) * run_board_theme_host_state.TICK_MS

// `text` as far as `shown` letters have reached it.
function typed(text: string, shown: number): string {
	return text.slice(0, Math.max(0, shown))
}

// Where the stamp's first word starts: over the area, kept on screen.
function stamp_at(draw: ThemeDraw): Point {
	const { h, edge, area_top } = draw.api.layout

	return {
		y: Math.max(1, Math.min(h - CLOSE.up, area_top + CLOSE.row)),
		x: Math.max(0, Math.floor(edge / PAIR) - CLOSE.back),
	}
}

// The odds over the stamp, their percent landing last.
function odds(draw: ThemeDraw, at: Point, shown: number): void {
	const { x, y } = at

	put(draw.grid, { y, x }, typed(CLOSE.odds, shown - CLOSE.odds_after), ink(RGB.soft))

	if (shown > CLOSE.full_after) {
		put(draw.grid, { y, x: x + CLOSE.full_x }, CLOSE.full, bold(RGB.white))
	}
}

// The stamp on a patch cleared for it: the odds over it, the two-weight line, a rule under it.
function stamp(draw: ThemeDraw): void {
	const { grid, tick } = draw
	const { x, y } = stamp_at(draw)
	const shown = tick * CLOSE.pace
	const rule = Math.min(CLOSE.rule_w, shown - CLOSE.rule_after)

	for (let row = -1; row <= 1; row++) {
		put(grid, { y: y + row, x: x - CLOSE.box_x }, repeated(' ', CLOSE.box_w), 'body')
	}

	put(grid, { y, x }, typed(CLOSE.word, shown), bold(RGB.cyan))
	put(grid, { y, x: x + CLOSE.rest_x }, typed(CLOSE.rest, shown - CLOSE.rest_after), ink(RGB.text))
	put(grid, { y: y + 1, x }, repeated('─', rule), ink(RGB.blue))
	odds(draw, { y: y - 1, x }, shown)
}

function wipe_row(row: Array<Cell>, since: number): void {
	const gone = [...row.keys()].filter(
		(x) => since > hash(Math.floor(x / CLOSE.column), CLOSE.salt, CLOSE.salt) * CLOSE.spread,
	)

	for (const x of gone) row[x] = BLANK
}

// The board leaves in columns, each a few cells wide at a moment of its own, the lowest rows first.
function wipe(draw: ThemeDraw, elapsed: number): void {
	const { h } = draw.api.layout

	for (const [y, row] of draw.grid.entries()) wipe_row(row, elapsed - (h - y) * CLOSE.rise)
}

function ending_draw(draw: ThemeDraw): void {
	const { api, grid, tick } = draw
	const grey = ink(mix(RGB.grey, RGB.night, CLOSE.grey))

	if (tick >= CLOSE.stamp_ticks + CLOSE.wipe_ticks) {
		api.blank_screen(grid)

		return
	}

	restyle(
		grid,
		() => true,
		() => grey,
	)
	stamp(draw)
	if (tick >= CLOSE.stamp_ticks) wipe(draw, tick - CLOSE.stamp_ticks)
}

function ending_of(api: ThemeApi): ThemePart {
	return {
		ticks: CLOSE.stamp_ticks + CLOSE.wipe_ticks + CLOSE.empty_ticks,
		note: 'the board freezes grey under MISSION SUCCESSFUL · it leaves in columns · a second of empty screen',
		// The stamp's letters, typed until its last figure lands.
		typing: { spans: [{ from_ms: 0, to_ms: STAMP_TYPED_MS }], typed_ms: STAMP_TYPED_MS },
		draw: (grid, tick, state) => {
			ending_draw({ api, grid, s: state, tick })
		},
	}
}

const run_board_theme_deviant_ending = { ending_of, typed }

export { run_board_theme_deviant_ending }
