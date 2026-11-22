import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fit, type FrameParts, type TerminalSize } from './run-board-fit'
import { run_board_fixture } from './run-board-fixture'
import { run_board_fold, type FrameBounds } from './run-board-fold'
import { run_board_idle_rain, type RainMoment } from './run-board-idle-rain'
import { run_board_lamp_spots } from './run-board-lamp-spots'
import { run_board_quota_lamps } from './run-board-quota-lamps'
import { run_board_render_quota } from './run-board-render-quota'
import { run_board_render_throughput } from './run-board-render-throughput'
import { run_board_spin } from './run-board-spin'
import { run_board_spot } from './run-board-spot'
import type { Theme } from './run-board-theme-defs'
import type { ThroughputRow } from './run-board-throughput'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#8647: on a rain frame the usage rule's row runs the panel too, its rule ended two
// columns before the panel's start, and the frame's whole draw writes the rain's cells, never a `■`.

const { LAMP, LAMP_MARK, LAMP_START } = run_board_spot
const { width_of } = run_board_fit
const { rows_part } = run_board_render_throughput
const { START } = run_board_fixture
const HOUR = 3_600_000
const GAP = 2
const PANEL_WIDTH = 21
const FRAME_MS = 70
const RAIN_ROWS = 6
const LAMP_PATTERN = new RegExp(`[${LAMP}${LAMP_START}]`, 'u')
const ROWS_TEXT = ['     CLAUDE  7d 84%', '     CODEX  —', '     GITHUB  REST 8%']

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
const PANEL_START = width_of(rows_part(ROWS, false).lines[0]?.text ?? '') + GAP

interface Panel {
	usage_rows?: ReadonlyArray<string>
	has_lamps?: boolean
	has_rain?: boolean
}

// A live frame's throughput and usage sections, the rule run on to `PANEL_WIDTH` past the panel's start.
function panel_parts(panel: Panel): FrameParts {
	const { usage_rows = ROWS_TEXT, has_lamps = true, has_rain = true } = panel
	const usage = run_board_render_quota.usage_part({
		quotas: { claude: undefined, codex: undefined },
		now_ms: START,
		has_lamps,
		has_rain,
	})
	const lines = run_board_quota_lamps
		.provider_rows(usage_rows, has_lamps)
		.map((text) => ({ text, is_detail: false }))

	return {
		above: [],
		plan: [],
		legend: [],
		footer: [],
		notes: { head: [], lines: [], hidden: 0 },
		throughput: rows_part(ROWS, has_lamps),
		usage: usage === undefined ? undefined : { ...usage, lines },
		rule_width: PANEL_START + PANEL_WIDTH,
	}
}

function frame_of(panel: Panel, bounds: FrameBounds = {}): Array<string> {
	return run_board_fold.bounded(panel_parts(panel), bounds)
}

function plain(lines: ReadonlyArray<string>): Array<string> {
	return lines.map((line) => stripVTControlCharacters(line))
}

function usage_rule(lines: ReadonlyArray<string>): string {
	return plain(lines).find((line) => line.includes('usage')) ?? ''
}

describe('the usage rule’s row on a rain frame', () => {
	it('ends the rule two columns before the panel and runs the panel on from its start', () => {
		const rule = usage_rule(frame_of({}))
		const kept = rule.slice(0, rule.indexOf(LAMP))

		expect(width_of(kept)).toBe(PANEL_START)
		expect(width_of(kept.trimEnd())).toBe(PANEL_START - GAP)
		expect(kept.trimEnd()).toMatch(/usage.*─$/u)
	})

	it('makes six panel rows, all starting at the same column', () => {
		const lamped = plain(frame_of({})).filter((line) => line.includes(LAMP))
		const starts = lamped.map((line) => width_of(line.slice(0, line.indexOf(LAMP))))

		expect(lamped).toHaveLength(RAIN_ROWS)
		expect(new Set(starts)).toStrictEqual(new Set([PANEL_START]))
	})

	it.each([
		['a frame with no rain', { has_rain: false }],
		['a frame with no lamps', { has_lamps: false }],
		['usage rows with no room for the panel', { usage_rows: ['x'.repeat(PANEL_START + 1)] }],
	])('draws the rule whole with %s', (_, panel: Panel) => {
		const rule = usage_rule(frame_of(panel))

		expect(rule).not.toMatch(LAMP_PATTERN)
		expect(width_of(rule)).toBe(PANEL_START + PANEL_WIDTH)
	})

	it('draws the rule whole where the usage section is folded', () => {
		const folded = plain(frame_of({}, { folded: new Set(['usage']) }))

		expect(folded.filter((line) => line.includes(LAMP))).toHaveLength(ROWS.length)
		expect(usage_rule(folded)).not.toMatch(LAMP_PATTERN)
	})
})

// The lines of a six-row panel: the throughput rows, the blank line, the rule and two usage rows.
const PANEL = `${LAMP} ${LAMP} ${LAMP} ${LAMP}`
const LINES = [
	`  24h  ${PANEL}`,
	`   7d  ${PANEL}`,
	`       ${PANEL}`,
	`-- -- ${PANEL}`,
	`  CL   ${PANEL}`,
	`  CO   ${PANEL}`,
]
const IDLE: RainMoment = { ms: START, is_burst: false }

// The first frame's moment from `IDLE` on with the column's drop's head on the panel's row `row`.
function head_at(column: number, row: number, panel_rows: number): RainMoment {
	const frames = Array.from({ length: 1000 }, (_, index) => ({
		ms: IDLE.ms + index * FRAME_MS,
		is_burst: false,
	}))

	const found = frames.find(
		(at) => Math.floor(run_board_idle_rain.row_at(column, at, panel_rows)) === row,
	)

	expect(found).toBeDefined()

	return found ?? IDLE
}

describe('the idle rain on six rows', () => {
	it('counts every panel row of the frame for each lamp', () => {
		const lamps = run_board_lamp_spots.lamps_in(LINES, [1, 2, 3, 4, 5, 6], 200)

		expect(new Set(lamps.map((lamp) => lamp.panel_rows))).toStrictEqual(new Set([RAIN_ROWS]))
		expect(Math.max(...lamps.map((lamp) => lamp.panel_row))).toBe(RAIN_ROWS - 1)
	})

	it('runs the drop’s head down to the sixth row', () => {
		const lamp = run_board_lamp_spots
			.lamps_in(LINES, [1, 2, 3, 4, 5, 6], 200)
			.find((each) => each.panel_row === RAIN_ROWS - 1)
		const column = lamp?.column ?? 0
		const at = head_at(column, RAIN_ROWS - 1, RAIN_ROWS)
		const place = { column, panel_row: RAIN_ROWS - 1, panel_rows: RAIN_ROWS }

		expect(stripVTControlCharacters(run_board_idle_rain.cell_text(place, at)).trim()).not.toBe('')
	})

	it('keeps a five-row panel’s cycle as it was', () => {
		for (const column of [3, 17, 41]) {
			expect(run_board_idle_rain.row_at(column, IDLE, 5)).toBe(
				run_board_idle_rain.row_at(column, IDLE),
			)
		}
	})
})

describe('run_board_spin.spun on a rain frame', () => {
	it('draws every lamp as the rain’s cell, never a `■`', () => {
		const drawn = run_board_spin.spun(LINES, '⠋', undefined, IDLE)

		expect(drawn.lines.join('')).not.toContain(LAMP_MARK)
		expect(drawn.lines.join('')).not.toContain(LAMP)
		expect(drawn.lamps).toHaveLength(RAIN_ROWS * 4)
	})

	it('draws every lamp as `■` with no rain', () => {
		const drawn = run_board_spin.spun(LINES, '⠋')

		expect(drawn.lines.join('').split(LAMP_MARK)).toHaveLength(RAIN_ROWS * 4 + 1)
	})

	it('keeps the rule row’s lamps among the cells the falling drops pass by', () => {
		const drawn = run_board_spin.spun(LINES, '⠋', undefined, IDLE)
		const rule_row = 4

		expect(drawn.lamps.filter((lamp) => lamp.row === rule_row)).toHaveLength(4)
	})
})

function wide(): TerminalSize {
	return { rows: 60, columns: 200 }
}

// The `■`s the written frames hold outside the throughput header, whose `TRACE` gauge draws `■` too.
function marks_in(frames: ReadonlyArray<string>): number {
	const lines = stripVTControlCharacters(frames.join('')).split('\n')
	const panel = lines.filter((line) => !line.includes('TRACE'))

	return panel.join('').split(LAMP_MARK).length - 1
}

// A live redraw of a frame with throughput rows in `theme` on a terminal drawing color: its lamps and the
// `■`s its whole draw wrote outside the header.
function redrawn(theme: Theme): { lamps: number; marks: number } {
	vi.stubEnv('FORCE_COLOR', '3')
	const { LOCAL, drawn_from, harness, plan_titled } = run_board_fixture
	const { FRESH_STATE, layout_for } = run_board_tick
	const { ports, frames } = harness(LOCAL, [])
	const state = { ...FRESH_STATE, plan: plan_titled('a'), run_started_ms: LOCAL.started_ms }
	const local = { ...LOCAL, throughput: ROWS }
	const redraw = { ports: { ...ports, types_rows: true, theme, size: wide }, now_ms: START }
	const drawn = drawn_from(state, local, redraw, layout_for(state, local, START))

	return { lamps: drawn.lamps?.length ?? 0, marks: marks_in(frames) }
}

describe('run_board_tick_draw’s whole draw', () => {
	it('writes no `■` on a matrix board, whose panel rains', () => {
		const { lamps, marks } = redrawn('matrix')

		expect(lamps).toBeGreaterThan(0)
		expect(marks).toBe(0)
	})

	it('writes every lamp as `■` on a wargames board', () => {
		const { lamps, marks } = redrawn('wargames')

		expect(lamps).toBeGreaterThan(0)
		expect(marks).toBe(lamps)
	})
})
