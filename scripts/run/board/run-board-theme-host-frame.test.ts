import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_fonts } from './run-board-theme-host-fonts'
import { run_board_theme_host_frame } from './run-board-theme-host-frame'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { DemoKey } from './run-board-theme-host-sample'
import { run_board_theme_host_snap_fixture } from './run-board-theme-host-snap-fixture'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Grid, ThemeLayout, ThemeModule, ThemeState } from './run-board-theme-host-types'

// joshuafolkken/kit#8917: the theme host's frame against the confirmed theme demo. Two probe themes
// (one with a background, colons and a known name; one in capitals with its own board name and
// spinner) are drawn through the demo host's own `frame_of` and through this port, and every
// finished frame — characters, painted styles and washes — must hash the same. The demo side is
// `__snapshots__/run-board-theme-host-probe.json`, recorded by
// `.josh/tmp/handoff-halfrun-1795540927344/probe-build.mjs`, `probe-demo.mjs` and `probe-store.mjs`.

// The progress settle, switched off where a test compares with the demo, which has none.
const SETTLE = vi.hoisted(() => ({ is_off: false }))

vi.mock(import('./run-board-theme-host-settle'), async (original) => {
	const { run_board_theme_host_settle: actual } = await original()

	return {
		run_board_theme_host_settle: {
			...actual,
			settle_progress: (...frame: Parameters<typeof actual.settle_progress>) => {
				if (!SETTLE.is_off) actual.settle_progress(...frame)
			},
		},
	}
})

const { HOST } = run_board_theme_host_fixture
const { api } = HOST
const { BOLD } = run_board_theme_host_grid
const { BLOCKS } = run_board_theme_host_fonts
const { blink_colons, finalize, lay_spinner, role_style, sgr_of, spinner_frame, stepped } =
	run_board_theme_host_frame
const { frame_at } = run_board_theme_host_snap_fixture
const { state_of } = run_board_theme_host_state

interface ProbeRecord {
	frames: Record<string, string>
	layout: Record<string, unknown>
}

const PROBE_URL = new URL('__snapshots__/run-board-theme-host-probe.json', import.meta.url)
const PROBE = JSON.parse(readFileSync(PROBE_URL, 'utf8')) as ProbeRecord

// The probe's state readout, as the demo probe writes it.
function probe_readout(grid: Grid, state: ThemeState, tick: number): void {
	const { px } = api.layout
	const counts = `${state.since} ${state.done} ${state.busy_ticks} ${state.event.total}`
	const flags = `${api.trace_on(state) ? 'ON' : 'off'} ${api.active(state.row, 20)}`
	const noise = `${api.digit(api.hash(tick, 3, 4))}${api.pick('abc', api.hash(tick))}`

	api.put(
		grid,
		{ y: 5, x: px },
		`T${tick} ${state.latest ?? '-'} ${counts} ${state.last_start}`,
		'hi:bold',
	)
	api.put(
		grid,
		{ y: 6, x: px },
		`${flags} ${api.finished(state.progress)} ${state.busy}`,
		'warn:dim',
	)
	api.put(grid, { y: 7, x: px }, `${noise}${BLOCKS[tick % 9]}`, 'rule')
}

function probe_marks(grid: Grid, state: ThemeState, tick: number): void {
	const { px } = api.layout

	api.notice_trace(grid, state, '200;20;20')
	api.start_flash(grid, state, tick, api.fg('9;9;9'))
	api.peak_flash(grid, state, `${api.fg('1;2;3')}${BOLD}`)
	probe_readout(grid, state, tick)
	api.put(grid, { y: 8, x: px }, 'X')
	api.put(grid, { y: 8, x: px + 1 }, 'Y', `${api.fg('1;1;1')}${api.bg('2;2;2')}`)
}

function probe_shapes(grid: Grid, tick: number): void {
	const { px, w, head_right } = api.layout

	if (tick % 7 === 0) api.tear(grid, 13, 2)
	if (tick % 5 === 0) api.tear(grid, 14, -3)
	api.big_number(grid, { y: 9, x: px + 20 }, '1.5', {
		style: api.fg('5;5;5'),
		ghost: api.fg('6;6;6'),
	})
	api.framed(grid, { x: px + 30, y: 5, w: 12, h: 4 }, 'BOX', 'ok')
	api.banner(grid, { ...head_right, top: 0 }, 'ALERT', 'red:bold')
	if (tick % 2 === 0) api.put(grid, { y: 1, x: -2 }, 'clipped-left', 'hi')
	api.put(grid, { y: 3, x: w - 3 }, 'clipped-right', 'hi')
}

function probe_draw(grid: Grid, state: ThemeState, tick: number): void {
	probe_marks(grid, state, tick)
	probe_shapes(grid, tick)
}

const PALE = '255;240;220'
const PROBE_COLORS = {
	body: '255;150;30',
	rule: '140;70;0',
	ok: '120;255;150',
	red: '255;50;40',
	warn: '255;210;0',
	hi: PALE,
	type: '255;235;200',
	notice: PALE,
}
const PROBE_THEME: ThemeModule = { name: 'PROBE', colors: PROBE_COLORS, draw: probe_draw }

const PROBES = new Map<string, ThemeModule>([
	[
		'8',
		{
			name: 'MATRIX',
			colons: true,
			colors: PROBE_COLORS,
			background: (x, y, tick) =>
				(x + y + tick) % 3 === 0 ? `${x};${y};${(tick * 7) % 256}` : undefined,
			draw: probe_draw,
		},
	],
	[
		'9',
		{
			...PROBE_THEME,
			board: 'josh-probe',
			capitals: true,
			spinner: '0123',
			colors: { ...PROBE_COLORS, rule: '1;2;3' },
		},
	],
])

interface SettledCell {
	y: number
	is_same_char: boolean
}

function probe_frame(key: string): ReturnType<typeof frame_at> {
	const probe = PROBES.get(key.slice(0, 1))

	if (!probe) throw new Error(`No probe theme for ${key}`)

	return frame_at(probe, key.slice(1, 2) as DemoKey, Number(key.slice(2)))
}

// The cells of probe frame `key` the progress settle changed.
function settled_cells(key: string): Array<SettledCell> {
	SETTLE.is_off = true
	const typed = probe_frame(key)

	SETTLE.is_off = false
	const settled = probe_frame(key)

	return settled.flatMap((row, y) =>
		row
			.map((cell, x) => ({ cell, was: typed[y]?.[x] }))
			.filter(({ cell, was }) => JSON.stringify(cell) !== JSON.stringify(was))
			.map(({ cell, was }) => ({ y, is_same_char: cell[0] === was?.[0] })),
	)
}

// A probe key is the probe theme's digit, the demo event's letter and the tick.
function probe_hash(key: string): string {
	const frame = JSON.stringify(probe_frame(key))

	return createHash('sha256').update(frame).digest('hex').slice(0, 16)
}

// The layout under the demo host's own names.
function demo_names(layout: ThemeLayout): Record<string, unknown> {
	return {
		H: layout.h,
		W: layout.w,
		EDGE: layout.edge,
		PX: layout.px,
		PW: layout.pw,
		AREA_TOP: layout.area_top,
		AREA_END: layout.area_end,
		COLUMN_X: layout.column_x,
		PINS_X: layout.pins_x,
		NOTICE: layout.notice,
		PROGRESS: layout.progress,
		ROW: layout.row,
		ROW_TEXT: layout.row_text,
		LANE_ROWS: layout.lane_rows,
		GAP_ROWS: layout.gap_rows,
		ISSUE_X: layout.issue_x,
		NEW_LANE: layout.new_lane,
		DEFCON: layout.level_spot,
		HEAD_LEFT: layout.head_left,
		HEAD_RIGHT: layout.head_right,
		HEAD_TOP: layout.head_top,
		LAST_TEXT_ROW: layout.last_text_row,
		SIGN_X: layout.sign_x,
		HEAD_COLONS: layout.head_colons,
		SCREEN_CX: layout.screen_cx,
		SCREEN_CY: layout.screen_cy,
	}
}

describe('run_board_theme_host_frame against the demo host', () => {
	// The one intended difference: kit settles the typed progress line back to the board's colors
	// (`run-board-theme-host-settle.ts`, the confirmed specification §2); the demo keeps it typed.
	it('finishes every probe frame exactly as the demo does, the progress settle aside', () => {
		const keys = Object.keys(PROBE.frames)

		SETTLE.is_off = true
		const differing = keys.filter((key) => probe_hash(key) !== PROBE.frames[key])

		SETTLE.is_off = false
		expect(keys.length).toBeGreaterThan(100)
		expect(differing).toStrictEqual([])
	})

	it('settles only the progress line’s styles, its characters kept', () => {
		const keys = Object.keys(PROBE.frames).filter((key) => key.slice(1, 2) === 'p')
		const changed = keys.flatMap((key) => settled_cells(key))

		expect(changed.length).toBeGreaterThan(0)
		expect(changed.every(({ y }) => y === HOST.layout.progress.y)).toBe(true)
		expect(changed.every(({ is_same_char }) => is_same_char)).toBe(true)
	})

	it('finds the layout the demo host finds', () => {
		expect(demo_names(HOST.layout)).toStrictEqual(PROBE.layout)
	})
})

describe('run_board_theme_host_frame.stepped', () => {
	it('rounds each channel to the nearest step of six, capped at 255', () => {
		expect(stepped('0;2;3')).toBe('0;0;6')
		expect(stepped('8;9;10')).toBe('6;12;12')
		expect(stepped('254;255;250')).toBe('252;255;252')
	})
})

function state_at(tick: number): ThemeState {
	return state_of(HOST.layout, HOST.events.r, tick)
}

function board_copy(): Grid {
	return HOST.board.map((row) => [...row])
}

describe('run_board_theme_host_frame.spinner_frame', () => {
	it('turns kit’s ten-frame cycle a frame each 80 ms and maps it onto the glyphs', () => {
		expect(spinner_frame('0123456789', 0)).toBe('0')
		expect(spinner_frame('0123456789', 2)).toBe('1')
		expect(spinner_frame('0123456789', 16)).toBe('0')
		expect(spinner_frame('│╱─╲', 5)).toBe('╱')
		expect(spinner_frame('│╱─╲', 13)).toBe('╲')
	})
})

describe('run_board_theme_host_frame.lay_spinner', () => {
	const { lane_rows, lane_spin_x, row, sign_x } = HOST.layout
	const theme: ThemeModule = { ...PROBE_THEME, spinner: 'ab' }

	it('lays the frame in the signs column and each lane, not the new lane before it arrives', () => {
		const grid = board_copy()

		lay_spinner(grid, HOST.layout, theme, state_at(0))

		expect(grid[2]?.[sign_x]).toStrictEqual(['a', 'body'])
		expect(lane_rows.map((y) => grid[y]?.[lane_spin_x]?.[0])).toStrictEqual([
			'a',
			'a',
			HOST.board[row.y]?.[lane_spin_x]?.[0],
		])
	})

	it('turns the new lane once it arrives', () => {
		const grid = board_copy()

		lay_spinner(grid, HOST.layout, theme, state_at(10))

		expect(lane_rows.map((y) => grid[y]?.[lane_spin_x]?.[0])).toStrictEqual(['b', 'b', 'b'])
	})
})

describe('run_board_theme_host_frame.blink_colons', () => {
	const colons = HOST.layout.head_colons
	const LIT_COLON: Cell = [':', 'body']

	it('dims the header clocks’ colons in the dark half second only, for a theme with colons', () => {
		const lit = board_copy()
		const dark = board_copy()
		const off = board_copy()

		blink_colons(lit, HOST.layout, { ...PROBE_THEME, colons: true }, 9)
		blink_colons(dark, HOST.layout, { ...PROBE_THEME, colons: true }, 10)
		blink_colons(off, HOST.layout, PROBE_THEME, 10)

		expect(colons.map(({ y, x }) => lit[y]?.[x])).toStrictEqual(colons.map(() => LIT_COLON))
		expect(colons.map(({ y, x }) => dark[y]?.[x])).toStrictEqual(
			colons.map(() => [':', 'body:dim']),
		)
		expect(colons.map(({ y, x }) => off[y]?.[x])).toStrictEqual(colons.map(() => LIT_COLON))
	})

	it('leaves a colon an effect has repainted', () => {
		const grid = board_copy()
		const [first] = colons

		if (first) grid[first.y]?.splice(first.x, 1, [':', 'hi'])
		blink_colons(grid, HOST.layout, { ...PROBE_THEME, colons: true }, 10)

		expect(first && grid[first.y]?.[first.x]).toStrictEqual([':', 'hi'])
	})
})

describe('run_board_theme_host_frame.finalize', () => {
	const washed: ThemeModule = {
		...PROBE_THEME,
		background: (x) => (x === 0 ? undefined : '7;8;250'),
	}
	// The wash '7;8;250' rounded to steps of six.
	const stepped_wash = '6;6;252'
	const raw = '\u{1B}[38;2;1;2;3m'
	const raw_on_background = `${raw}\u{1B}[48;2;4;5;6m`
	const grid: Grid = [
		[
			['a', 'body'],
			['b', 'rule:dim'],
			['c', raw],
			['d', raw_on_background],
		],
	]

	it('paints role keys, keeps raw styles, and washes only cells whose style sets no background', () => {
		expect(finalize(grid, washed, state_at(0))).toStrictEqual([
			[
				['a', api.fg(PROBE_COLORS.body), ''],
				['b', `${api.fg(PROBE_COLORS.rule)}\u{1B}[2m`, stepped_wash],
				['c', raw, stepped_wash],
				['d', raw_on_background, ''],
			],
		])
	})

	it('washes nothing for a theme with no background', () => {
		const behind = finalize(grid, PROBE_THEME, state_at(0))[0]?.map((cell) => cell[2])

		expect(behind).toStrictEqual(['', '', '', ''])
	})

	it('writes the wash after the painted style', () => {
		expect(sgr_of(['c', BOLD, '6;6;252'])).toBe(`${BOLD}\u{1B}[48;2;6;6;252m`)
		expect(sgr_of(['c', BOLD, ''])).toBe(BOLD)
	})
})

describe('run_board_theme_host_frame.role_style', () => {
	it('paints a role in its color, dim or bold, and an unknown role in the body color', () => {
		expect(role_style(PROBE_COLORS, 'rule')).toBe('\u{1B}[38;2;140;70;0m')
		expect(role_style(PROBE_COLORS, 'hi:dim')).toBe('\u{1B}[38;2;255;240;220m\u{1B}[2m')
		expect(role_style(PROBE_COLORS, 'ok:bold')).toBe('\u{1B}[38;2;120;255;150m\u{1B}[1m')
		expect(role_style(PROBE_COLORS, 'nothing')).toBe('\u{1B}[38;2;255;150;30m')
	})
})
