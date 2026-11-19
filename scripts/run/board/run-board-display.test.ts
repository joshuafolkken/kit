import { describe, expect, it } from 'vitest'
import { run_board_display, type BoardDisplay } from './run-board-display'
import { run_board_fixture } from './run-board-fixture'
import type { BoardLayout, BoardRow } from './run-board-layout'
import type { BoardState } from './run-board-state'
import { run_board_tick } from './run-board-tick'
import { run_board_tick_draw } from './run-board-tick-draw'

const { LOCAL, START, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, layout_for } = run_board_tick
const { assemble_display } = run_board_display
const { draw_display } = run_board_tick_draw
const SECOND = 1000
const RUNNING = 11

function planned(): BoardState {
	return { ...FRESH_STATE, plan: plan_titled('a'), run_started_ms: LOCAL.started_ms }
}

function running_row(): BoardRow {
	return {
		number: RUNNING,
		title: undefined,
		kind: undefined,
		state: 'running',
		status: undefined,
		waits: [],
	}
}

function layout_over(state: BoardState, rows: ReadonlyArray<BoardRow>): BoardLayout {
	return { ...layout_for(state, LOCAL, START), active: rows }
}

function assembled(state: BoardState, rows: ReadonlyArray<BoardRow>, now_ms: number): BoardDisplay {
	return assemble_display(state, LOCAL, now_ms, layout_over(state, rows))
}

describe('run_board_display.assemble_display', () => {
	it('holds no function, so a structured clone of it is equal to it', () => {
		const display = assembled(planned(), [running_row()], START)

		expect(structuredClone(display)).toStrictEqual(display)
	})

	it('decides the cue a lane starting sounds without any port', () => {
		const state = planned()
		const before = assembled(state, [], START)
		const after = assembled({ ...state, ...before.carried }, [running_row()], START + SECOND)

		expect(before.cue).toBeUndefined()
		expect(after.cue).toBe('launch')
		expect(after.header.notice?.cause.issue).toBe(RUNNING)
	})

	it('pins the baseline total the next frame carries to the plan’s first count', () => {
		const display = assembled(planned(), [running_row()], START)

		expect(display.carried.baseline_total).toBe(1)
	})
})

describe('run_board_tick_draw.draw_display', () => {
	it('writes one frame from the assembled display and carries its sound on', () => {
		const { ports, frames } = harness(LOCAL, [])
		const state = planned()
		const display = assembled(state, [running_row()], START)
		const next = draw_display(state, display, { ports, now_ms: START })

		expect(frames).toHaveLength(1)
		expect(next).toMatchObject(display.carried)
	})
})
