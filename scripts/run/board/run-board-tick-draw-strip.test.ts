import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import type { BoardRow } from './run-board-layout'
import type { ThroughputRow } from './run-board-throughput'
import { run_board_tick } from './run-board-tick'

const { LOCAL, START, drawn_from, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, layout_for } = run_board_tick
const WIDE = { rows: 60, columns: 200 }
const HOUR = 3_600_000

afterEach(() => {
	vi.unstubAllEnvs()
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
