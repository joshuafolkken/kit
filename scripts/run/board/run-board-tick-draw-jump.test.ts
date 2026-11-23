import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import type { BoardRow } from './run-board-layout'
import type { BoardState } from './run-board-state'
import { run_board_tick } from './run-board-tick'

const { IDLE_ROW, LOCAL, START, drawn_from, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, layout_for } = run_board_tick
const SECOND = 1000
const SIZE = { columns: 200, rows: 60 }
// A board with throughput rows, where the frame lays out the animation area.
const THROUGHPUT = { ...LOCAL, throughput: [IDLE_ROW, IDLE_ROW] }
// A running lane whose long number runs the frame's rules on past room for the area's lamps.
const RUNNING: ReadonlyArray<BoardRow> = [
	{
		number: 123_456_789,
		title: undefined,
		kind: undefined,
		state: 'running',
		status: undefined,
		waits: [],
	},
]

afterEach(() => {
	vi.unstubAllEnvs()
})

// A live bttf redraw over `rows` at `now_ms` on a colored terminal.
function bttf_over(state: BoardState, rows: ReadonlyArray<BoardRow>, now_ms: number): BoardState {
	vi.stubEnv('FORCE_COLOR', '3')
	const { ports } = harness(LOCAL, [])
	const live = {
		...ports,
		types_rows: true,
		is_live: true,
		is_tty: true,
		theme: 'bttf' as const,
		size: (): typeof SIZE => SIZE,
		opened_ms: START,
	}
	const run_layout = { ...layout_for(state, THROUGHPUT, START), active: rows }

	return drawn_from(state, THROUGHPUT, { ports: live, now_ms }, run_layout)
}

// joshuafolkken/kit#8782: the jump a redraw starts leaves the animation area's painter its own cells.
describe('run_board_tick_draw.draw_display bttf jump', () => {
	it('hands the jump the cells the area painter draws', () => {
		const planned = { ...FRESH_STATE, plan: plan_titled('a'), run_started_ms: LOCAL.started_ms }
		const base = bttf_over(planned, [], START)
		const launched = bttf_over(base, RUNNING, START + SECOND)

		expect(launched.jump?.owned?.size ?? 0).toBeGreaterThan(0)
	})
})
