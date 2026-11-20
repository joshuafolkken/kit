import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import type { BoardRow } from './run-board-layout'
import { run_board_theme_defs } from './run-board-theme-defs'
import type { ThroughputRow } from './run-board-throughput'
import { run_board_tick } from './run-board-tick'
import { run_board_tick_draw } from './run-board-tick-draw'

const { THEME_DEFS } = run_board_theme_defs
const { decoded_of, has_strip } = run_board_tick_draw
const { LOCAL, START, drawn_from, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, layout_for } = run_board_tick
const WIDE = { rows: 60, columns: 200 }
const HOUR = 3_600_000
const STRIP_ON = {
	...THEME_DEFS,
	wargames: { ...THEME_DEFS.wargames, live: { ...THEME_DEFS.wargames.live, strip: true } },
}

afterEach(() => {
	vi.unstubAllEnvs()
})

// joshuafolkken/kit#8398: the lamp strip (joshuafolkken/kit#8376) is off by default behind the theme's
// `live.strip`, the rules' launch codes left as they are.
describe('run_board_tick_draw.has_strip', () => {
	it('fills no strip in the wargames theme by default', () => {
		expect(has_strip({ theme: 'wargames' })).toBe(false)
	})

	it('fills the strip once the wargames definition switches it on', () => {
		expect(has_strip({ theme: 'wargames' }, STRIP_ON)).toBe(true)
	})

	it('fills no strip in a theme whose rules run no code, even switched on', () => {
		const matrix_on = {
			...THEME_DEFS,
			matrix: { ...THEME_DEFS.matrix, live: { ...THEME_DEFS.matrix.live, strip: true } },
		}

		expect(has_strip({ theme: 'matrix' }, matrix_on)).toBe(false)
	})

	it('fills no strip with no theme', () => {
		expect(has_strip({ theme: undefined }, STRIP_ON)).toBe(false)
	})
})

function row_of(label: ThroughputRow['label'], now: number | undefined): ThroughputRow {
	const cells = [{ start_ms: 0, end_ms: HOUR, done: 2, active_ms: HOUR }]

	return { label, cells, active_ms: HOUR, done: 2, per_hour: 2, peak: undefined, now }
}

// A running lane whose long number runs the frame's rules on past room for the lamp panel.
const WIDE_LANE: BoardRow = {
	number: 123_456_789,
	title: undefined,
	kind: undefined,
	state: 'running',
	status: undefined,
	waits: [],
}

// A live redraw of a wargames frame drawing its lamp panel on a terminal drawing color.
function drawn_lit(): ReturnType<typeof drawn_from> {
	vi.stubEnv('FORCE_COLOR', '3')
	const { ports } = harness(LOCAL, [])
	const state = { ...FRESH_STATE, plan: plan_titled('a'), run_started_ms: LOCAL.started_ms }
	const local = { ...LOCAL, throughput: [row_of('24h', 5), row_of('7d', undefined)] }
	const theme = 'wargames' as const
	const redraw = { ports: { ...ports, types_rows: true, theme, size: () => WIDE }, now_ms: START }
	const layout = { ...layout_for(state, local, START), active: [WIDE_LANE] }

	return drawn_from(state, local, redraw, layout)
}

describe('run_board_tick_draw.draw_display — the lamp strip off', () => {
	it('keeps the rules’ code and no strip cell on a wargames board drawing its lamp panel', () => {
		const drawn = drawn_lit()

		expect(drawn.lamps?.length ?? 0).toBeGreaterThan(0)
		expect(drawn.rules?.length ?? 0).toBeGreaterThan(0)
		expect(drawn.strips).toStrictEqual([])
	})
})

const STRIP_CELL = { row: 4, column: 70, index: 0, count: 1 }
const RULE_CELL = { row: 5, column: 0 }

describe('run_board_tick_draw.decoded_of', () => {
	it('keeps the strip cells and the rules’ code once the wargames definition switches the strip on', () => {
		const drawn = { rules: [RULE_CELL], strips: [STRIP_CELL] }

		expect(decoded_of({ theme: 'wargames' }, drawn, STRIP_ON)).toStrictEqual(drawn)
	})

	it('keeps the rules’ code and drops the strip cells by default', () => {
		const drawn = { rules: [RULE_CELL], strips: [STRIP_CELL] }

		expect(decoded_of({ theme: 'wargames' }, drawn)).toStrictEqual({
			rules: [RULE_CELL],
			strips: [],
		})
	})
})
