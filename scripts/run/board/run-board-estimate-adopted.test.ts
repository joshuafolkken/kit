import { describe, expect, it } from 'vitest'
import { run_board_estimate, type EstimateRead } from './run-board-estimate'
import type { BoardLayout, BoardRow } from './run-board-layout'

// joshuafolkken/kit#8455: a lane this run took over from an ended run counts as its own, but its time
// began under that run, so the 🎯 estimate leaves it out as it left out the earlier run's lane (🧳).

const MINUTE = 60_000
const NOW = Date.parse('2026-11-21T09:00:00.000Z')
const EMPTY_LAYOUT: BoardLayout = { active: [], queued: [], people: [], unreached: [] }
const TOTALS = [20 * MINUTE, 30 * MINUTE, 40 * MINUTE]
const MOVING = { ended_ms: undefined, activity: { is_stopped: false } }

function running(number: number, elapsed: number, is_adopted?: boolean): BoardRow {
	const status = {
		state: 'running' as const,
		track: ['implement' as const],
		phase_ms: NOW - elapsed * MINUTE,
		started_ms: NOW - elapsed * MINUTE,
		is_adopted,
	}

	return { number, title: undefined, kind: undefined, state: 'running', status, waits: [] }
}

function read(active: ReadonlyArray<BoardRow>): EstimateRead {
	return {
		now_ms: NOW,
		ended_ms: undefined,
		layout: { ...EMPTY_LAYOUT, active: [...active] },
		lane_totals: TOTALS,
		lane_limit: 2,
	}
}

describe('run_board_estimate for an adopted lane', () => {
	it('draws no finish on an adopted running row', () => {
		expect(run_board_estimate.is_finish_drawn(running(1, 5, true), MOVING)).toBe(false)
	})

	it('still draws a finish on a running row this run launched', () => {
		expect(run_board_estimate.is_finish_drawn(running(1, 5), MOVING)).toBe(true)
	})

	it('leaves an adopted running row out of the run’s finish', () => {
		const own = running(1, 5)
		const adopted = running(2, 300, true)

		// 15′, 25′ and 35′ beyond 5′ — the adopted lane's five hours move nothing.
		expect(run_board_estimate.left_ms(read([own, adopted]))).toBe(25 * MINUTE)
	})

	it('estimates nothing when only an adopted lane runs', () => {
		const adopted = running(1, 5, true)

		expect(run_board_estimate.left_ms(read([adopted]))).toBeUndefined()
	})
})
