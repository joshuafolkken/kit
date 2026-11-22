import { serialize } from 'node:v8'
import { describe, expect, it } from 'vitest'
import { run_board_display, type BoardDisplay } from './run-board-display'
import { run_board_fixture } from './run-board-fixture'
import type { BoardLayout, BoardRow } from './run-board-layout'
import type { LocalRead } from './run-board-read'
import type { BoardState } from './run-board-state'
import { run_board_tick } from './run-board-tick'
import { run_board_tick_draw } from './run-board-tick-draw'

const { LOCAL, START, harness, plan_titled, ticks } = run_board_fixture
const { FRESH_STATE, layout_for } = run_board_tick
const { assemble_display } = run_board_display
const { draw_display } = run_board_tick_draw
const SECOND = 1000
const RUNNING = 11
const WAITING = 12
const FEW_EVENTS = 10
const MANY_EVENTS = 15_000

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

// A row waiting on another, with the reason it waits.
function waiting_row(): BoardRow {
	const reason = {
		icon: '⏳',
		value: String(RUNNING),
		tail: 'waits',
		issues: [`#${String(RUNNING)}`],
	}

	return {
		...running_row(),
		number: WAITING,
		state: 'waiting',
		waits: [`#${String(RUNNING)}`],
		reason,
	}
}

function layout_over(
	state: BoardState,
	rows: ReadonlyArray<BoardRow>,
	local: LocalRead = LOCAL,
): BoardLayout {
	return { ...layout_for(state, local, START), active: rows }
}

function assembled(
	state: BoardState,
	rows: ReadonlyArray<BoardRow>,
	now_ms: number,
	local: LocalRead = LOCAL,
): BoardDisplay {
	return assemble_display(state, local, now_ms, layout_over(state, rows, local))
}

// A run of `count` events with an empty seat held back, over a running row and one waiting on it.
function busy_display(count: number): BoardDisplay {
	const local = {
		...LOCAL,
		events: ticks(count),
		lane_limit: 2,
		occupied_count: 1,
		launch_hold: 'held',
	}

	return assembled(planned(), [running_row(), waiting_row()], START, local)
}

describe('run_board_display.assemble_display', () => {
	it('holds no function, so a structured clone of it is equal to it', () => {
		const display = assembled(planned(), [running_row()], START)

		expect(structuredClone(display)).toStrictEqual(display)
	})

	it('clones equal with events, a row’s reason and waits, and a seat in it', () => {
		const display = busy_display(FEW_EVENTS)

		expect(display.header.seats).toBeDefined()
		expect(structuredClone(display)).toStrictEqual(display)
	})

	// joshuafolkken/kit#8179: the display is as large as its rows, never its run's event stream.
	it('serializes to the same size for 15,000 events as for 10 drawing the same rows', () => {
		const [few, many] = [FEW_EVENTS, MANY_EVENTS].map((count) => serialize(busy_display(count)))

		expect(many?.length).toBe(few?.length)
		expect(JSON.stringify(busy_display(MANY_EVENTS))).not.toContain('"events"')
	})

	it('decides the cue a lane starting sounds without any port', () => {
		const state = planned()
		const before = assembled(state, [], START)
		const after = assembled({ ...state, ...before.carried }, [running_row()], START + SECOND)

		expect(before.cue).toBeUndefined()
		expect(after.cue).toBe('launch')
		expect(after.header.notice?.cause.issue).toBe(RUNNING)
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
