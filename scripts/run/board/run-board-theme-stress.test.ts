import { describe, expect, it } from 'vitest'
import { run_board_theme_host_api } from './run-board-theme-host-api'
import { run_board_theme_host_frame } from './run-board-theme-host-frame'
import { run_board_theme_host_sample, type DemoEvent } from './run-board-theme-host-sample'
import type { FinalGrid, ThemeApi, ThemeLayout, ThemeModule } from './run-board-theme-host-types'
import { run_board_theme_layout } from './run-board-theme-layout'
import { run_board_theme_registry } from './run-board-theme-registry'
import { run_board_theme_roles } from './run-board-theme-roles'
import type { ThemeValue } from './run-board-theme-run'
import { run_board_theme_stress_fixture, type StressBoard } from './run-board-theme-stress-fixture'

// joshuafolkken/kit#8917: every theme on boards of other sizes than the demo's, at and above the
// smallest panel a theme is drawn on (`run-board-theme-layout.ts`: six panel rows, forty columns).
// Every event, the opening and the ending of all seven themes is drawn at sampled ticks; none may
// throw, every frame keeps the terminal's rows and columns, and while IDLE no theme's panel parts
// paint over the section under the panel — every character the board writes in the panel's columns
// on the two rows under its area (the gap and the next section's rule) stays. The demo's idle touches
// restyle the board everywhere, so styles are not compared; BTTF's crackle lights blank cells anywhere,
// so blanks are not either; MATRIX's rain and STEINS;GATE's glitches rewrite characters anywhere by
// design, so their idle is not checked.

const { MIN_PANEL_ROWS, MIN_PANEL_WIDTH, edit_board, layout_of } = run_board_theme_layout
const { frame_of, part_frame_of, part_of } = run_board_theme_host_frame
const { stress_board } = run_board_theme_stress_fixture
const THEMES: ReadonlyArray<ThemeValue> = [
	'wopr',
	'trace',
	'flux',
	'codec',
	'nixie',
	'skynet',
	'magi',
]
// Their idle touches rewrite characters anywhere on the board.
const SCREEN_WIDE: ReadonlySet<ThemeValue> = new Set(['trace', 'nixie'])
// Ticks sampled: an event's every seventh, with the normal display after it; a part's every third.
const EVENT_STEP = 7
const PART_STEP = 3
const AFTER_TICKS = 60
const UNDER_ROWS = 2
const DEMO = { edge: 114, px: 68, panel_rows: 7 }
// A live board at 200×50 lays its rules and panel out so (a real-data `board:replay`).
const LIVE = { edge: 118, px: 69 }
const NARROW_PX = 40
const WIDE_PX = 74

function minimum(px: number): { edge: number; px: number } {
	return { edge: px + MIN_PANEL_WIDTH, px }
}

// The smallest panel at the demo's panel column, at a narrow board's and one further right; the demo's
// own board, a wide one; terminals as wide as the board and wider, short and tall; no lane, one and
// three; panels of six (the smallest), seven (the demo's), eight and nine rows; a live 200×50 board.
const MATRIX: ReadonlyArray<StressBoard> = [
	{ columns: 108, rows: 30, ...minimum(DEMO.px), lanes: 1, panel_rows: MIN_PANEL_ROWS },
	{ columns: 80, rows: 24, ...minimum(NARROW_PX), lanes: 0, panel_rows: MIN_PANEL_ROWS },
	{ columns: 199, rows: 60, ...DEMO, lanes: 3 },
	{ columns: 240, rows: 40, edge: 160, px: DEMO.px, lanes: 3, panel_rows: 8 },
	{ columns: 130, rows: 24, ...minimum(DEMO.px), lanes: 0, panel_rows: 9 },
	{ columns: 115, rows: 60, ...minimum(WIDE_PX), lanes: 1, panel_rows: 8 },
	{ columns: 200, rows: 50, ...LIVE, lanes: 3, panel_rows: MIN_PANEL_ROWS },
]

type Events = ReturnType<typeof run_board_theme_host_sample.demo_events>

interface Board {
	api: ThemeApi
	layout: ThemeLayout
	events: Events
}

function board_of(board: StressBoard): Board {
	const { cells, view, size } = stress_board(board)
	const grid = run_board_theme_roles.grid_of(cells)
	const layout = layout_of(view, grid, size)

	if (layout === undefined) throw new Error(`no layout: ${JSON.stringify(board)}`)
	edit_board(grid, layout)

	return {
		api: run_board_theme_host_api.theme_api_of(layout, grid),
		layout,
		events: run_board_theme_host_sample.demo_events(layout.row_text),
	}
}

function theme_of(value: ThemeValue, api: ThemeApi): ThemeModule {
	const factory = run_board_theme_registry.factory_of(value)

	if (factory === undefined) throw new Error(`no theme: ${value}`)

	return factory(api)
}

// An event's sampled ticks: an opening or ending for its own length, an event for its length and the
// normal display after it.
function ticks_of(theme: ThemeModule, layout: ThemeLayout, event: DemoEvent): Array<number> {
	const last = event.part
		? part_of(theme, layout, event.part).ticks
		: event.last + AFTER_TICKS + Math.max(0, ...Object.values(theme.lasts ?? {}))
	const step = event.part ? PART_STEP : EVENT_STEP

	return Array.from({ length: Math.ceil(last / step) }, (_, index) => index * step)
}

function drawn(theme: ThemeModule, api: ThemeApi, event: DemoEvent, tick: number): FinalGrid {
	return event.part
		? part_frame_of(theme, api, event.part, tick)
		: frame_of(theme, api, event, tick)
}

// The frame's rows and columns where they are not the terminal's.
function misshapen(frame: FinalGrid, layout: ThemeLayout): Array<string> {
	const widths = frame.map((row) => row.length).filter((width) => width !== layout.w)

	return frame.length === layout.h && widths.length === 0
		? []
		: [`${String(frame.length)} rows, widths ${widths.join(' ')}`]
}

function char_at(frame: FinalGrid, y: number, x: number): string {
	return frame[y]?.[x]?.[0] ?? ' '
}

// Whether the plain frame's cell at (y, x) has a character the theme's frame changed.
function is_painted(frame: FinalGrid, plain: FinalGrid, y: number, x: number): boolean {
	const ch = char_at(plain, y, x)

	return ch.trim() !== '' && char_at(frame, y, x) !== ch
}

// The panel's written cells on the rows under its area whose character the theme changed.
function painted_under(frame: FinalGrid, plain: FinalGrid, layout: ThemeLayout): Array<string> {
	const rows = Array.from({ length: UNDER_ROWS }, (_, index) => layout.area_end + 1 + index)
	const columns = Array.from({ length: layout.edge - layout.px }, (_, index) => layout.px + index)

	return rows.flatMap((y) =>
		columns.filter((x) => is_painted(frame, plain, y, x)).map((x) => `${String(y)}:${String(x)}`),
	)
}

// One theme on one board: the theme, the same theme drawing nothing of its own, and the board.
interface Run {
	value: ThemeValue
	theme: ThemeModule
	plain: ThemeModule
	board: Board
}

// The problems of one frame: a misshapen frame, or an IDLE frame painting under the panel.
function frame_problems(run: Run, key: string, event: DemoEvent, tick: number): Array<string> {
	const { api, layout } = run.board
	const frame = drawn(run.theme, api, event, tick)
	const is_checked = key === 'i' && !SCREEN_WIDE.has(run.value)
	const under = is_checked ? painted_under(frame, drawn(run.plain, api, event, tick), layout) : []

	return [...misshapen(frame, layout), ...under]
}

function tick_problems(run: Run, key: string, event: DemoEvent, tick: number): Array<string> {
	const at = `${run.value} ${key}${String(tick)}`
	let problems: Array<string>

	try {
		problems = frame_problems(run, key, event, tick)
	} catch (error) {
		problems = [`threw ${String(error)}`]
	}

	return problems.map((problem) => `${at} ${problem}`)
}

// Every problem with the theme's frames on `board`: a throw, a misshapen frame, an idle paint under
// the panel.
function problems_of(value: ThemeValue, board: Board): Array<string> {
	const theme = theme_of(value, board.api)
	const run = { value, theme, plain: { ...theme, draw: () => undefined }, board }

	return Object.entries(board.events).flatMap(([key, event]) =>
		ticks_of(theme, board.layout, event).flatMap((tick) => tick_problems(run, key, event, tick)),
	)
}

describe('run_board_theme themes on boards of every size', () => {
	// One case a theme and a board, so no case carries all seven themes' frames at once.
	const cases = MATRIX.flatMap((stress) => THEMES.map((value) => ({ stress, value })))

	it.each(cases)('draws $value on $stress', ({ stress, value }) => {
		const problems = problems_of(value, board_of(stress))

		expect(problems.slice(0, 5)).toStrictEqual([])
	})

	// joshuafolkken/kit#8917 (the confirmed specification §2): the theme keeps its looks on a panel
	// under the smallest; only its area falls off the frame.
	it('lays the area off the frame on a panel under the smallest', () => {
		const smallest: StressBoard = {
			columns: 108,
			rows: 30,
			...minimum(DEMO.px),
			lanes: 1,
			panel_rows: MIN_PANEL_ROWS,
		}
		const short = stress_board({ ...smallest, panel_rows: MIN_PANEL_ROWS - 1 })
		const narrow = stress_board({ ...smallest, edge: smallest.edge - 1 })

		for (const { cells, view, size } of [short, narrow]) {
			const layout = layout_of(view, run_board_theme_roles.grid_of(cells), size)

			expect(layout?.area_top).toBeGreaterThanOrEqual(size.rows)
		}
	})
})
