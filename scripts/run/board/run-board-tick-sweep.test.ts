import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import type { BoardState } from './run-board-state'
import { run_board_tick } from './run-board-tick'

const { LOCAL, START, drawn_from, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, layout_for, tick } = run_board_tick
const PANE = { rows: 24, columns: 80 }
const AGED_MS = 5000
const SWEEP = { row: 4, left: 8 }

// The board's sweep carried from frame to frame (joshuafolkken/kit#8240).
describe('run_board_tick — the sweep (joshuafolkken/kit#8240)', () => {
	it('carries the sweep the drawn frame records under its third line', () => {
		const local = {
			...LOCAL,
			events: [
				{
					pos: 0,
					at: new Date(START).toISOString(),
					kind: 'setup' as const,
					text: run_event_setup.opening_lane('8'),
				},
			],
		}
		const { ports } = harness(local, [])
		const state: BoardState = {
			...FRESH_STATE,
			plan: plan_titled('a'),
			run_started_ms: LOCAL.started_ms,
		}
		const redraw = { ports: { ...ports, size: () => PANE }, now_ms: START + AGED_MS }
		const drawn = drawn_from(state, local, redraw, layout_for(state, local, START))

		expect(drawn.sweep).toStrictEqual({ row: 4, left: 5 })
	})

	it('drops the last frame’s sweep when it draws no run', async () => {
		const { ports } = harness(undefined, [plan_titled('a')])
		const drawn = await tick({ ...FRESH_STATE, sweep: SWEEP }, ports)

		expect(drawn.sweep).toBeUndefined()
		expect(drawn.spots).toStrictEqual([])
	})
})

// joshuafolkken/kit#8404: a run that waits keeps its heartbeat — in a theme too.
describe('run_board_tick — the sweep of a waiting run (joshuafolkken/kit#8404)', () => {
	it('carries the sweep of a watching run in the wargames theme', () => {
		const local = {
			...LOCAL,
			events: [{ pos: 0, at: new Date(START).toISOString(), kind: 'drain' as const, text: 'x' }],
		}
		const { ports } = harness(local, [])
		const state: BoardState = { ...FRESH_STATE, run_started_ms: LOCAL.started_ms }
		const themed = { ...ports, size: () => PANE, theme: 'wargames' as const }
		const redraw = { ports: themed, now_ms: START + AGED_MS }
		const drawn = drawn_from(state, local, redraw, layout_for(state, local, START))

		expect(drawn.sweep).toBeDefined()
	})
})
