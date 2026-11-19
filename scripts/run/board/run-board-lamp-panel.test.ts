import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fit, type FrameParts } from './run-board-fit'
import { run_board_fixture } from './run-board-fixture'
import { run_board_fold } from './run-board-fold'
import type { BoardRow } from './run-board-layout'
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

afterEach(() => {
	vi.unstubAllEnvs()
})

function row_of(label: ThroughputRow['label'], now: number | undefined): ThroughputRow {
	return {
		label,
		cells: [{ start_ms: 0, end_ms: HOUR, done: 2, active_ms: HOUR }],
		window_ms: HOUR,
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

	it('draws no panel where eight lamps do not fit', () => {
		const start = width_of(texts(false)[0] ?? '') + GAP
		const lines = bounded_rows(start + FEWEST * GAP - 2)

		expect(lines.join('')).not.toMatch(new RegExp(`[${LAMP}${LAMP_START}]`, 'u'))
		expect(lines.map((line) => line.trimEnd())).toStrictEqual(lines)
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
