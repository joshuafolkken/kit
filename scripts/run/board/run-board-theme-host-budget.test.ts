import { describe, expect, it } from 'vitest'
import { run_board_cells, type Cells } from './run-board-cells'
import { run_board_cells_diff } from './run-board-cells-diff'
import { run_board_screen } from './run-board-screen'
import { run_board_theme_codec } from './run-board-theme-codec'
import { run_board_theme_flux } from './run-board-theme-flux'
import { run_board_theme_host_cells } from './run-board-theme-host-cells'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_snap_fixture } from './run-board-theme-host-snap-fixture'
import type { ThemeFactory, ThemeModule } from './run-board-theme-host-types'
import { run_board_theme_magi } from './run-board-theme-magi'
import { run_board_theme_nixie } from './run-board-theme-nixie'
import { run_board_theme_skynet } from './run-board-theme-skynet'
import { run_board_theme_trace } from './run-board-theme-trace'
import { run_board_theme_wopr } from './run-board-theme-wopr'

// joshuafolkken/kit#8917: what the seven theme ports cost kit's screen on the demo's board (199 columns,
// 60 rows). Every frame of every event, opening and ending fits the style id table with room to spare;
// each theme's whole NOTICE, written frame to frame by kit's diff writer, writes no more than the confirmed
// demo's own light writer did for the same frames, and stays under the Issue's per-frame average.

const { MAX_STYLE, UNSET, cells_of } = run_board_cells
const { diff } = run_board_cells_diff
const { cells_of_frame } = run_board_theme_host_cells
const { HOST } = run_board_theme_host_fixture
const { CHECK_EVENTS, check_ticks, frame_at, last_of, theme_of } = run_board_theme_host_snap_fixture
const SIZE = { rows: HOST.layout.h, columns: HOST.layout.w }
// The style ids every theme's frames use together stay under this share of the id space.
const STYLE_SHARE = 4
const AVERAGE_LIMIT = 60 * 1024
// Every frame of all seven themes is built, a few thousand frames each.
const ALL_THEMES_MS = 180_000
const ONE_THEME_MS = 60_000

interface Budget {
	name: string
	factory: ThemeFactory
	// The demo's light writer (`light + band`, its default) over the theme's whole NOTICE, in UTF-16
	// units: `DEMO_MEASURE=1` on `.josh/tmp/scratch/fixed-v21-theme-demo.mjs`, its total summed exactly.
	demo_total: number
}

const BUDGETS: ReadonlyArray<Budget> = [
	{ name: 'wopr', factory: run_board_theme_wopr.theme, demo_total: 2_746_789 },
	{ name: 'trace', factory: run_board_theme_trace.theme, demo_total: 13_281_267 },
	{ name: 'flux', factory: run_board_theme_flux.theme, demo_total: 2_295_427 },
	{ name: 'codec', factory: run_board_theme_codec.theme, demo_total: 3_589_986 },
	{ name: 'nixie', factory: run_board_theme_nixie.theme, demo_total: 5_262_908 },
	{ name: 'skynet', factory: run_board_theme_skynet.theme, demo_total: 5_649_115 },
	{ name: 'magi', factory: run_board_theme_magi.theme, demo_total: 6_011_316 },
]

function add_styles(styles: Set<number>, cells: Cells): void {
	for (const style of cells.styles) styles.add(style)
}

// Every style id the theme's frames use, over every frame of every demo event, opening and ending.
function styles_of(theme: ThemeModule, styles: Set<number>): void {
	for (const event of CHECK_EVENTS) {
		for (const tick of check_ticks(theme, event)) {
			add_styles(styles, cells_of_frame(frame_at(theme, event, tick), SIZE))
		}
	}
}

// The UTF-16 length kit writes for each frame of the theme's NOTICE, from a screen it knows nothing of:
// the cells that changed, in one synchronized write, nothing where none did.
function notice_writes(theme: ThemeModule): Array<number> {
	const front = cells_of(SIZE, UNSET)

	return Array.from({ length: last_of(theme, 'n') }, (_, tick) => {
		const bytes = diff(cells_of_frame(frame_at(theme, 'n', tick), SIZE), front)

		return bytes === '' ? 0 : run_board_screen.synced(bytes).length
	})
}

function sum(values: ReadonlyArray<number>): number {
	return values.reduce((total, value) => total + value, 0)
}

describe('run_board_theme ports on the style id table', () => {
	it(
		'use a quarter of the style ids at most over every frame of all seven themes',
		() => {
			const styles = new Set<number>()

			for (const { factory } of BUDGETS) styles_of(theme_of(factory), styles)

			expect(styles.size).toBeLessThan(MAX_STYLE / STYLE_SHARE)
		},
		ALL_THEMES_MS,
	)
})

describe('run_board_theme ports written by the diff writer', () => {
	it.each(BUDGETS)(
		'write $name NOTICE in no more than the demo did',
		({ factory, demo_total }) => {
			const writes = notice_writes(theme_of(factory))

			expect(sum(writes)).toBeLessThanOrEqual(demo_total)
			expect(sum(writes) / writes.length).toBeLessThan(AVERAGE_LIMIT)
		},
		ONE_THEME_MS,
	)
})
