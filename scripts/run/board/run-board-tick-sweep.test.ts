import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import type { BoardRow } from './run-board-layout'
import { run_board_spot } from './run-board-spot'
import type { BoardState } from './run-board-state'
import { run_board_tick } from './run-board-tick'

const { LOCAL, START, drawn_from, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, layout_for, tick } = run_board_tick
const PANE = { rows: 24, columns: 80 }
const AGED_MS = 5000
const SWEEP = { row: 4, left: 8 }

// The board's sweep carried from frame to frame (joshuafolkken/kit#8240).
describe('run_board_tick — the sweep (joshuafolkken/kit#8240)', () => {
	it.each([undefined, 'matrix', 'wargames'] as const)(
		'scopes the working sweep to wargames: %s',
		(theme) => {
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
			const redraw = { ports: { ...ports, theme, size: () => PANE }, now_ms: START + AGED_MS }
			const drawn = drawn_from(state, local, redraw, layout_for(state, local, START))

			expect(drawn.sweep).toStrictEqual(theme === 'wargames' ? { row: 4, left: 5 } : undefined)
		},
	)

	it('drops the last frame’s sweep when it draws no run', async () => {
		const { ports } = harness(undefined, [plan_titled('a')])
		const drawn = await tick({ ...FRESH_STATE, sweep: SWEEP }, ports)

		expect(drawn.sweep).toBeUndefined()
		expect(drawn.spots).toStrictEqual([])
	})
})

// joshuafolkken/kit#8404, #8425: waiting runs keep their heartbeat only in wargames.
describe('run_board_tick — the sweep of a waiting run (joshuafolkken/kit#8404)', () => {
	it.each([undefined, 'matrix', 'wargames'] as const)('scopes waiting sweeps to %s', (theme) => {
		const local = {
			...LOCAL,
			events: [{ pos: 0, at: new Date(START).toISOString(), kind: 'drain' as const, text: 'x' }],
		}
		const { ports } = harness(local, [])
		const state: BoardState = { ...FRESH_STATE, run_started_ms: LOCAL.started_ms }
		const themed = { ...ports, size: () => PANE, theme }
		const redraw = { ports: themed, now_ms: START + AGED_MS }
		const layout = layout_for(state, local, START)
		const person: BoardRow = {
			number: 2,
			state: 'human',
			title: 'waiting',
			kind: undefined,
			status: undefined,
			waits: [],
		}

		expect(drawn_from(state, local, redraw, layout).sweep !== undefined).toBe(theme === 'wargames')
		const human = { ...layout, active: [], queued: [], people: [person], unreached: [] }

		expect(drawn_from(state, local, redraw, human).sweep !== undefined).toBe(theme === 'wargames')
	})
})

describe('run_board_tick — frames without a sweep', () => {
	it.each(['stopped', 'ended', 'once', 'chat'] as const)('draws no sweep for %s', (mode) => {
		const local = {
			...LOCAL,
			is_stranded: mode === 'stopped',
			ended_ms: mode === 'ended' ? START + AGED_MS : undefined,
		}
		const { ports, frames } = harness(local, [])
		const state: BoardState = { ...FRESH_STATE, run_started_ms: LOCAL.started_ms }
		const themed = {
			...ports,
			theme: 'wargames' as const,
			is_tty: mode !== 'once' && mode !== 'chat',
			form: mode === 'chat' ? ('chat' as const) : ('screen' as const),
			size: () => PANE,
		}
		const redraw = { ports: themed, now_ms: START + AGED_MS }
		const drawn = drawn_from(state, local, redraw, layout_for(state, local, START))

		expect(drawn.sweep).toBeUndefined()
		expect(frames.join('')).not.toContain(run_board_spot.TICK)
	})
})
