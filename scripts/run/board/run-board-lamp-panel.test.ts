import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fit, type FrameParts } from './run-board-fit'
import { run_board_fixture } from './run-board-fixture'
import { run_board_fold } from './run-board-fold'
import type { BoardRow } from './run-board-layout'
import { run_board_quota_lamps } from './run-board-quota-lamps'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_quota } from './run-board-render-quota'
import { run_board_render_throughput } from './run-board-render-throughput'
import { run_board_spot } from './run-board-spot'
import type { ThroughputRow } from './run-board-throughput'
import { run_board_tick } from './run-board-tick'
import { run_board_tick_draw } from './run-board-tick-draw'

// joshuafolkken/kit#8236: where the WOPR lamp panel goes — two columns past the throughput rows' NOW,
// on to the end of the section's rule — and the boards that draw none.

const { LAMP, LAMP_MARK, LAMP_START } = run_board_spot
const { LOCAL, START, drawn_from, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, layout_for } = run_board_tick
const WIDE = { rows: 60, columns: 200 }
const { rows_part } = run_board_render_throughput
const { has_lamps } = run_board_tick_draw
const { width_of } = run_board_fit
const HOUR = 3_600_000
const GAP = 2
const FEWEST = 8
// A panel 21 columns wide holds 11 lamps.
const PANEL_WIDTH = 21
const PANEL_LAMPS = 11
const SAMPLE_RULE_WIDTH = 114
const SAMPLE_ROW_END = 67
const SAMPLE_LAMP_COLUMN = 70
const SAMPLE_LAMPS = 23

afterEach(() => {
	vi.unstubAllEnvs()
})

function row_of(label: ThroughputRow['label'], now: number | undefined): ThroughputRow {
	return {
		label,
		cells: [{ start_ms: 0, end_ms: HOUR, done: 2, active_ms: HOUR }],
		active_ms: HOUR,
		done: 2,
		per_hour: 2,
		peak: undefined,
		now,
	}
}

const ROWS = [row_of('24h', 5), row_of('7d', undefined)]
// A running lane whose long number runs the frame's rules on past room for eight lamps.
const WIDE_LANE: BoardRow = {
	number: 123_456_789,
	title: undefined,
	kind: undefined,
	state: 'running',
	status: undefined,
	waits: [],
}

function texts(has_panel: boolean): Array<string> {
	return rows_part(ROWS, has_panel).lines.map((line) => stripVTControlCharacters(line.text))
}

// The throughput rows a live frame draws with its rule run on to `rule_width`.
function bounded_rows(rule_width: number): Array<string> {
	const parts: FrameParts = {
		above: [],
		plan: [],
		notes: { head: [], lines: [], hidden: 0 },
		legend: [],
		footer: [],
		throughput: rows_part(ROWS, true),
		rule_width,
	}

	return run_board_fold
		.bounded(parts, {})
		.map((line) => stripVTControlCharacters(line))
		.filter((line) => line.includes('24h') || line.includes('7d'))
}

describe('the throughput rows’ lamp panel', () => {
	it('starts two columns past NOW, at the same column on both rows', () => {
		const [day = '', week = ''] = texts(true)
		const [plain = ''] = texts(false)

		const before = day.slice(0, day.indexOf(LAMP_START))

		expect(width_of(before)).toBe(width_of(plain) + GAP)
		expect(week.indexOf(LAMP_START)).toBe(day.indexOf(LAMP_START))
	})

	it('is not started where the frame draws no lamps', () => {
		expect(texts(false).join('')).not.toContain(LAMP_START)
	})

	it('runs a lamp every other column on to the end of the section’s rule', () => {
		const start = width_of(texts(false)[0] ?? '') + GAP
		const lines = bounded_rows(start + 21)

		for (const line of lines) {
			expect(line.split(LAMP)).toHaveLength(12)
			expect(width_of(line)).toBe(start + 21)
		}
	})

	// joshuafolkken/kit#8280: the narrowed columns end the `24h` row at column 67, so a rule as wide
	// as the approved sample's (114) holds 23 lamps from column 70.
	it('starts at column 70 and holds 23 lamps on the approved sample’s rule', () => {
		const lines = bounded_rows(SAMPLE_RULE_WIDTH)

		expect(width_of(texts(false)[0] ?? '')).toBe(SAMPLE_ROW_END)

		for (const line of lines) {
			const before = line.slice(0, line.indexOf(LAMP))

			expect(width_of(before)).toBe(SAMPLE_LAMP_COLUMN - 1)
			expect(line.split(LAMP)).toHaveLength(SAMPLE_LAMPS + 1)
		}
	})

	it('draws no panel where eight lamps do not fit', () => {
		const start = width_of(texts(false)[0] ?? '') + GAP
		const lines = bounded_rows(start + FEWEST * GAP - 2)

		expect(lines.join('')).not.toMatch(new RegExp(`[${LAMP}${LAMP_START}]`, 'u'))
		expect(lines.map((line) => line.trimEnd())).toStrictEqual(lines)
	})
})

const ROWS_TEXT = ['     CLAUDE  7d 84%', '     CODEX  —', '     GITHUB  REST 8%']

// A live frame's throughput and usage sections, the usage rows as given, its rule run on to the panel's
// start and `PANEL_WIDTH` past it.
function panel_parts(usage_rows: ReadonlyArray<string>, has_panel: boolean): FrameParts {
	const start = width_of(texts(false)[0] ?? '') + GAP
	const usage = run_board_render_quota.usage_part({
		quotas: { claude: undefined, codex: undefined },
		now_ms: START,
		has_lamps: has_panel,
	})
	const lines = run_board_quota_lamps
		.provider_rows(usage_rows, has_panel)
		.map((text) => ({ text, is_detail: false }))

	return {
		above: [],
		plan: [],
		legend: [],
		footer: [],
		notes: { head: [], lines: [], hidden: 0 },
		throughput: rows_part(ROWS, has_panel),
		usage: usage === undefined ? undefined : { ...usage, lines },
		rule_width: start + PANEL_WIDTH,
	}
}

// The live frame drawn whole.
function panel_frame(usage_rows: ReadonlyArray<string>, has_panel = true): Array<string> {
	const parts = panel_parts(usage_rows, has_panel)

	return run_board_fold.bounded(parts, {}).map((line) => stripVTControlCharacters(line))
}

// The panel frame in a pane `rows` high, wide enough for every column.
function panel_pane(rows: number): Array<string> {
	const parts = panel_parts(ROWS_TEXT, true)
	const size = { rows, columns: WIDE.columns }

	return run_board_fold.bounded(parts, { size }).map((line) => stripVTControlCharacters(line))
}

function lamp_starts(lines: ReadonlyArray<string>): Array<number> {
	return lines
		.filter((line) => line.includes(LAMP))
		.map((line) => width_of(line.split(LAMP)[0] ?? ''))
}

describe('the lamp panel’s five rows (joshuafolkken/kit#8277)', () => {
	it('runs on throughput’s two rows, the blank line and usage’s first two rows alike', () => {
		const lines = panel_frame(ROWS_TEXT)
		const lamped = lines.filter((line) => line.includes(LAMP))
		const [start] = lamp_starts(lines)
		const leads = lamped.slice(2).map((line) => line.slice(0, line.indexOf(LAMP)).trimEnd())

		expect(lamped).toHaveLength(5)
		expect(lamp_starts(lines)).toStrictEqual(Array.from({ length: 5 }, () => start))
		for (const line of lamped) expect(line.split(LAMP)).toHaveLength(PANEL_LAMPS + 1)
		expect(leads).toStrictEqual(['', ...ROWS_TEXT.slice(0, 2)])
	})

	it('draws none on GitHub’s row or the usage rule', () => {
		const unlit = panel_frame(ROWS_TEXT).filter(
			(text) => text.includes('GITHUB') || text.includes('usage'),
		)

		expect(unlit).toHaveLength(2)
		expect(unlit.join('')).not.toContain(LAMP)
	})

	it('drops both usage rows’ lamps where one row reaches the panel, keeping the throughput three', () => {
		const long = 'x'.repeat(width_of(texts(false)[0] ?? '') + 1)
		const lines = panel_frame([ROWS_TEXT[0] ?? '', long, ROWS_TEXT[2] ?? ''])

		expect(lines.filter((line) => line.includes(LAMP))).toHaveLength(3)
		expect(lines).toContain(long)
		expect(lines).toContain(ROWS_TEXT[0])
	})

	it('gives way with the throughput rows: a pane that cuts them draws the usage rows unlit', () => {
		const whole = panel_frame(ROWS_TEXT).length
		const usage_only = panel_pane(whole - ROWS.length)

		expect(usage_only.join('')).not.toContain('24h')
		expect(usage_only).toContain(ROWS_TEXT[0])
		expect(usage_only.join('')).not.toMatch(new RegExp(`[${LAMP}${LAMP_START}]`, 'u'))
	})
})

describe('the lamp panel’s rows under the throughput rows, with no lamps', () => {
	it('leaves the blank line and the usage rows as they were where the frame draws no lamps', () => {
		const lines = panel_frame(ROWS_TEXT, false)
		const rule = lines.findIndex((line) => line.includes('usage'))

		expect(lines.join('')).not.toMatch(new RegExp(`[${LAMP}${LAMP_START}]`, 'u'))
		expect(lines[rule - 1]).toBe('')
		for (const row of ROWS_TEXT) expect(lines).toContain(row)
	})
})

// A whole board with throughput rows, a usage section and a lane wide enough for the panel, lamps as
// given.
function rendered(is_lit: boolean): Array<string> {
	const { EMPTY_LAYOUT } = run_board_render_fixture
	const header = run_board_render_fixture.header({
		quotas: { claude: undefined, codex: undefined },
		layout: { ...EMPTY_LAYOUT, active: [WIDE_LANE] },
	})
	const view = { header, notes: [], throughput: ROWS, has_lamps: is_lit }

	return run_board_render.render(view).map((line) => stripVTControlCharacters(line))
}

describe('run_board_render.render with lamps', () => {
	it('runs the panel on the usage section’s rows as well as the throughput rows', () => {
		const lamped = rendered(true).filter((line) => line.includes(LAMP))

		expect(lamped).toHaveLength(5)
		expect(lamped.filter((line) => line.includes('24h') || line.includes('7d'))).toHaveLength(2)
	})

	it('draws none where the board has no lamps', () => {
		expect(rendered(false).join('')).not.toContain(LAMP)
	})
})

describe('run_board_tick_draw.has_lamps', () => {
	it('draws lamps on a live board in a theme, on a terminal drawing color', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(has_lamps({ types_rows: true, is_tty: true })).toBe(true)
	})

	it.each([
		['no theme', { types_rows: undefined, is_tty: true }],
		['--every', { types_rows: false, is_tty: true }],
		['--once, --chat and a pipe', { types_rows: true, is_tty: false }],
	])('draws none with %s', (_, ports) => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(has_lamps(ports)).toBe(false)
	})

	it('draws none on a terminal drawing no color', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(has_lamps({ types_rows: true, is_tty: true })).toBe(false)
	})
})

// A live redraw of a frame with throughput rows, on a terminal drawing color; `types_rows` as given.
function redrawn(types_rows: boolean): { lamps: number; marks: number } {
	vi.stubEnv('FORCE_COLOR', '3')
	const { ports, frames } = harness(LOCAL, [])
	const state = { ...FRESH_STATE, plan: plan_titled('a'), run_started_ms: LOCAL.started_ms }
	const local = { ...LOCAL, throughput: ROWS }
	const redraw = { ports: { ...ports, types_rows, size: () => WIDE }, now_ms: START }
	const active = [{ ...WIDE_LANE }]
	const drawn = drawn_from(state, local, redraw, { ...layout_for(state, local, START), active })
	const written = stripVTControlCharacters(frames.join(''))

	return { lamps: drawn.lamps?.length ?? 0, marks: written.split(LAMP_MARK).length - 1 }
}

describe('run_board_tick_draw.draw_display with lamps', () => {
	it('draws the panel and keeps its lamps for the turns where the board has lamps', () => {
		const { lamps, marks } = redrawn(true)

		expect(lamps).toBeGreaterThanOrEqual(2 * FEWEST)
		expect(marks).toBe(lamps)
	})

	it('draws and keeps none where it has none', () => {
		expect(redrawn(false)).toStrictEqual({ lamps: 0, marks: 0 })
	})
})
