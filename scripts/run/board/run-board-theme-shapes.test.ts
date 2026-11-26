import { describe, expect, it } from 'vitest'
import { run_board_cells, type Cells } from './run-board-cells'
import { run_board_theme_demo_allowance_fixture } from './run-board-theme-demo-allowance-fixture'
import { run_board_theme_layer } from './run-board-theme-layer'
import { run_board_theme_layout } from './run-board-theme-layout'
import { run_board_theme_registry } from './run-board-theme-registry'
import { run_board_theme_roles } from './run-board-theme-roles'
import { run_board_theme_run, type ThemeValue } from './run-board-theme-run'
import {
	run_board_theme_stress_fixture,
	type LiveShape,
	type StressBoard,
} from './run-board-theme-stress-fixture'

// joshuafolkken/kit#8917: every work drawn through the live theme layer over the shapes a real board
// takes (the confirmed specification §2) — three running lanes, no lane, a folded THROUGHPUT, USAGE or
// LANES section, and a stopped run that turns no spinner. On each the theme draws without throwing,
// its level display ends on the rule's last column, it turns no spinner where kit turns none, and a
// lane's issue keeps its hyperlink wherever the theme left its character.

const { stress_board } = run_board_theme_stress_fixture
const { LEVELS } = run_board_theme_demo_allowance_fixture
const { theme_layer } = run_board_theme_layer
const ORIGIN_MS = 10_000
// Moments past the opening: a second, and five seconds into the idle board.
const MOMENTS_MS = [1000, 5000]
const LIVE: StressBoard = { columns: 200, rows: 50, edge: 118, px: 69, lanes: 3, panel_rows: 7 }
const OPEN: LiveShape = { folded: [], is_stopped: false }
const STOPPED = 'a stopped run'
const SHAPES: ReadonlyArray<readonly [string, StressBoard]> = [
	['three running lanes', { ...LIVE, shape: OPEN }],
	['no lane', { ...LIVE, lanes: 0, shape: OPEN }],
	['THROUGHPUT folded', { ...LIVE, shape: { ...OPEN, folded: ['throughput'] } }],
	['USAGE folded', { ...LIVE, shape: { ...OPEN, folded: ['usage'] } }],
	['LANES folded', { ...LIVE, shape: { ...OPEN, folded: ['lanes'] } }],
	[STOPPED, { ...LIVE, shape: { ...OPEN, is_stopped: true } }],
]
const LEVEL_OF: Readonly<Record<ThemeValue, RegExp>> = {
	'': /$^/u,
	wopr: /DEFCON(?: \[?\d\]?){5}/u,
	...LEVELS,
	flux: /$^/u,
}
// No level display while the board idles: flux has none, codec's CAUTION comes with a NOTICE.
const EVENT_LEVEL: ReadonlySet<ThemeValue> = new Set(['flux', 'codec'])
// Their idle rewrites characters anywhere on the board (rain, glitches), lane rows included.
const SCREEN_WIDE: ReadonlySet<ThemeValue> = new Set(['trace', 'nixie'])
const WORKS: ReadonlyArray<ThemeValue> = [
	'wopr',
	'trace',
	'flux',
	'codec',
	'nixie',
	'skynet',
	'magi',
]
// The lane rows' spinner column (0-based), past the lane's mark column.
const LANE_SPIN_X = 2
const ISSUE = /\d{4}/u
// Demo mode's sample rows' issues (`run-board-demo-lanes.ts`).
const SAMPLE_ISSUES = ['8899', '8897', '8826']

function row_text(cells: Cells, y: number): string {
	const row = cells.chars.subarray(y * cells.columns, (y + 1) * cells.columns)

	return [...row].map((char) => run_board_cells.char_text(char)).join('')
}

function run_of(work: ThemeValue): ReturnType<typeof run_board_theme_run.run_of> {
	const run = run_board_theme_run.run_of(work, run_board_theme_registry.factory_of)

	run.origin_ms = ORIGIN_MS
	run.part = undefined

	return run
}

interface Drawn {
	base: Cells
	cells: Cells
	level_y: number
	lane_rows: Array<number>
}

function drawn(work: ThemeValue, board: StressBoard, at_ms: number): Drawn {
	const { cells, view, size } = stress_board(board)
	const base = stress_board(board).cells
	const layout = run_board_theme_layout.layout_of(view, run_board_theme_roles.grid_of(base), size)

	theme_layer(run_of(work), view).draw(cells, ORIGIN_MS + at_ms)

	return {
		base,
		cells,
		level_y: layout?.level_spot.y ?? -1,
		lane_rows: view.keyed.filter(({ key }) => key.startsWith('lanes:')).map(({ row }) => row - 1),
	}
}

function level_end(text: string, label: RegExp): number | undefined {
	const match = label.exec(text)

	return match ? [...text.slice(0, match.index + match[0].length)].length : undefined
}

// The lane rows' issue cells whose character the theme left, and whether each kept its link.
function issue_links(frame: Drawn): Array<boolean> {
	return frame.lane_rows.flatMap((y) => {
		const at = ISSUE.exec(row_text(frame.base, y))?.index ?? -1
		const xs = [0, 1, 2, 3].map((offset) => y * frame.cells.columns + at + offset)

		return xs
			.filter((index) => frame.cells.chars[index] === frame.base.chars[index])
			.map((index) => {
				const { link } = run_board_cells.style_of(frame.cells.styles[index] ?? 0)

				return link === run_board_cells.style_of(frame.base.styles[index] ?? 0).link
			})
	})
}

function lane_spins(frame: Drawn): Array<string> {
	return frame.lane_rows.map((y) => row_text(frame.cells, y).slice(LANE_SPIN_X, LANE_SPIN_X + 1))
}

describe.each(SHAPES)('run_board_theme on a live board with %s', (_shape, board) => {
	it.each(WORKS)('draws %s on the board’s whole size', (work) => {
		for (const at_ms of MOMENTS_MS) {
			const frame = drawn(work, board, at_ms)

			expect(frame.cells.chars).toHaveLength(board.columns * board.rows)
			expect(frame.level_y).toBeGreaterThanOrEqual(0)
		}
	})

	it.each(WORKS.filter((work) => !EVENT_LEVEL.has(work)))(
		'ends the %s level display on the rule’s last column',
		(work) => {
			const frame = drawn(work, board, MOMENTS_MS[0] ?? 0)
			const end = level_end(row_text(frame.cells, frame.level_y), LEVEL_OF[work])

			expect(end).toBe(board.edge)
		},
	)

	it.each(WORKS.filter((work) => !SCREEN_WIDE.has(work)))(
		'keeps the %s lanes’ issue links where it left their characters',
		(work) => {
			const links = issue_links(drawn(work, board, MOMENTS_MS[1] ?? 0))

			expect(links.every(Boolean)).toBe(true)
		},
	)
})

describe('run_board_theme spinners on a live board', () => {
	const stopped = SHAPES.find(([shape]) => shape === STOPPED)?.[1] ?? LIVE
	const running = SHAPES[0]?.[1] ?? LIVE

	it.each(WORKS.filter((work) => !SCREEN_WIDE.has(work)))(
		'turns %s’s spinner on the running lanes only, none for a stopped run',
		(work) => {
			const turning = MOMENTS_MS.flatMap((at_ms) => lane_spins(drawn(work, running, at_ms)))
			const still = MOMENTS_MS.flatMap((at_ms) => lane_spins(drawn(work, stopped, at_ms)))

			expect(turning.some((spin) => spin.trim() !== '')).toBe(true)
			expect(still.every((spin) => spin === ' ')).toBe(true)
		},
	)

	// The confirmed specification §3: demo mode's sample lanes spin as running lanes, kit's spinners
	// or not.
	it.each(WORKS.filter((work) => !SCREEN_WIDE.has(work)))(
		'turns %s’s spinner on demo mode’s sample lanes',
		(work) => {
			const samples = { ...stopped, shape: { ...OPEN, is_stopped: true, issues: SAMPLE_ISSUES } }
			const spins = MOMENTS_MS.flatMap((at_ms) => lane_spins(drawn(work, samples, at_ms)))

			expect(spins.some((spin) => spin.trim() !== '')).toBe(true)
		},
	)
})
