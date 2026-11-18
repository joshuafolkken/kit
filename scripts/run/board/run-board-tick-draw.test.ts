import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_header } from './run-board-header'
import type { BoardState } from './run-board-state'
import { run_board_tick } from './run-board-tick'
import { run_board_tick_draw } from './run-board-tick-draw'

const { LOCAL, START, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, layout_for } = run_board_tick
const { bounds_of, draw_run } = run_board_tick_draw
const SIZE = { rows: 15, columns: 80 }
const FOOTER = ['footer']
const BASELINE = 7

function planned(): BoardState {
	return { ...FRESH_STATE, plan: plan_titled('a'), run_started_ms: LOCAL.started_ms }
}

describe('run_board_tick_draw.draw_run', () => {
	it('pins the baseline total to the first count the plan gives and writes one frame', () => {
		const { ports, frames } = harness(LOCAL, [])
		const state = planned()
		const run_layout = layout_for(state, LOCAL, START)
		const drawn = draw_run(state, LOCAL, { ports, now_ms: START }, run_layout)

		expect(drawn.baseline_total).toBe(run_board_header.counts_of(run_layout).total)
		expect(frames).toHaveLength(1)
	})

	it('keeps a baseline already pinned', () => {
		const { ports } = harness(LOCAL, [])
		const state = { ...planned(), baseline_total: BASELINE }
		const run_layout = layout_for(state, LOCAL, START)
		const drawn = draw_run(state, LOCAL, { ports, now_ms: START }, run_layout)

		expect(drawn.baseline_total).toBe(BASELINE)
	})

	it('pins no baseline before the plan is read', () => {
		const { ports } = harness(LOCAL, [])
		const run_layout = layout_for(FRESH_STATE, LOCAL, START)
		const drawn = draw_run(FRESH_STATE, LOCAL, { ports, now_ms: START }, run_layout)

		expect(drawn.baseline_total).toBeUndefined()
	})
})

describe('run_board_tick_draw.bounds_of', () => {
	it('reads the pane size, footer and folded sections off the ports', () => {
		const { ports } = harness(LOCAL, [])
		const folded = new Set<never>()
		const bounds = bounds_of({ ...ports, size: () => SIZE, footer: FOOTER, folded: () => folded })

		expect(bounds).toStrictEqual({ size: SIZE, footer: FOOTER, folded })
	})

	it('leaves every bound unset on ports with none', () => {
		const { ports } = harness(LOCAL, [])
		const bare = { ...ports, size: undefined, footer: undefined, folded: undefined }

		expect(bounds_of(bare)).toStrictEqual({ size: undefined, footer: undefined, folded: undefined })
	})
})
