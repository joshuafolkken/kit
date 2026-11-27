import { run_board_theme_deviant_data } from './run-board-theme-deviant-data'
import { run_board_theme_deviant_opening } from './run-board-theme-deviant-opening'
import { run_board_theme_deviant_parts } from './run-board-theme-deviant-parts'
import { run_board_theme_deviant_results } from './run-board-theme-deviant-results'
import { run_board_theme_deviant_tables } from './run-board-theme-deviant-tables'
import { run_board_theme_draw, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid, ThemeApi, ThemePart } from './run-board-theme-host-types'

// The deviant theme's ending, a results screen: the board freezes grey and the OPENING's light bars
// close over it; on the ice-white screen the results stand (`run-board-theme-deviant-results.ts`);
// the bars go dark one by one and the empty screen holds a second.

const { bg, restyle } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { TICK_MS } = run_board_theme_host_state
const { BLANK } = run_board_theme_draw
const { RGB } = run_board_theme_deviant_data
const { ice_at } = run_board_theme_deviant_opening
const { ink, mix } = run_board_theme_deviant_parts
const { results } = run_board_theme_deviant_results
const { RESULTS } = run_board_theme_deviant_tables
// The tick the last light bar has closed on: the results stand from here.
const BARS_SHUT = RESULTS.bars_from + RESULTS.bars_spread
const STATUS_LETTERS = RESULTS.word.length + 1 + RESULTS.rest.length
// When the status line types, in ms from the ENDING's start.
const STATUS_MS = {
	from: RESULTS.status_from * TICK_MS,
	to: (RESULTS.status_from + Math.ceil(STATUS_LETTERS / RESULTS.pace)) * TICK_MS,
}

// The columns whose light bar has moved by `elapsed` ticks, each bar a few columns wide at a moment
// of its own within `spread`.
function moved_columns(grid: Grid, elapsed: number, spread: number): Array<number> {
	const columns = [...(grid[0] ?? []).keys()]

	return columns.filter(
		(x) => elapsed >= hash(Math.floor(x / RESULTS.column), RESULTS.salt, RESULTS.salt) * spread,
	)
}

// The light bars close over the frozen board, bar by bar.
function close_bars(grid: Grid, elapsed: number): void {
	const closed = moved_columns(grid, elapsed, RESULTS.bars_spread)

	for (const row of grid) {
		for (const x of closed) row[x] = [' ', bg(ice_at(x, 1))]
	}
}

// The light bars go dark, bar by bar, the screen left empty behind them.
function shut_bars(grid: Grid, elapsed: number): void {
	const dark = moved_columns(grid, elapsed, RESULTS.shut_spread)

	for (const row of grid) {
		for (const x of dark) row[x] = BLANK
	}
}

// The board frozen grey, the light bars closing over it from `RESULTS.bars_from` on.
function frozen(draw: ThemeDraw): void {
	const { grid, tick } = draw
	const grey = ink(mix(RGB.grey, RGB.night, RESULTS.grey))

	restyle(
		grid,
		() => true,
		() => grey,
	)
	if (tick >= RESULTS.bars_from) close_bars(grid, tick - RESULTS.bars_from)
}

function ending_draw(draw: ThemeDraw): void {
	const { api, grid, tick } = draw

	if (tick >= RESULTS.shut_from + RESULTS.shut_ticks) api.blank_screen(grid)
	else if (tick < BARS_SHUT) frozen(draw)
	else results(draw, tick)

	if (tick >= RESULTS.shut_from) shut_bars(grid, tick - RESULTS.shut_from)
}

function ending_of(api: ThemeApi): ThemePart {
	return {
		ticks: RESULTS.shut_from + RESULTS.shut_ticks + RESULTS.empty_ticks,
		note: 'the board freezes grey · the light bars close · the results: MISSION SUCCESSFUL and the run in numbers · the bars go dark · a second of empty screen',
		// The status line's letters, typed until its last lands.
		typing: { spans: [{ from_ms: STATUS_MS.from, to_ms: STATUS_MS.to }], typed_ms: STATUS_MS.to },
		draw: (grid, tick, state) => {
			ending_draw({ api, grid, s: state, tick })
		},
	}
}

const run_board_theme_deviant_ending = { ending_of }

export { run_board_theme_deviant_ending }
