import { describe, expect, it } from 'vitest'
import { run_board_estimate, type EstimateRead } from './run-board-estimate'
import type { LaneBands } from './run-board-lane-totals'
import type { BoardLayout, BoardRow } from './run-board-layout'

// joshuafolkken/kit#8954: a running row's finish reads its declared size's band — later for a large
// Issue, sooner for a small one — and the whole totals where its band is too thin or it declared none.

const MINUTE = 60_000
const NOW = Date.parse('2026-11-27T09:00:00.000Z')
const EMPTY_LAYOUT: BoardLayout = { active: [], queued: [], people: [], unreached: [] }
const TOTALS = [20 * MINUTE, 30 * MINUTE, 40 * MINUTE]
const BAND_LANES = 5
const LARGE = 60 * MINUTE
const SMALL = 15 * MINUTE
const ELAPSED = 5 * MINUTE
const BANDS: LaneBands = {
	totals: new Map([
		['large', Array.from({ length: BAND_LANES }, () => LARGE)],
		['small', Array.from({ length: BAND_LANES }, () => SMALL)],
		['medium', [LARGE]],
	]),
	of_issue: new Map([
		[1, 'large'],
		[2, 'small'],
		[3, 'medium'],
	]),
}

// A child five minutes into its implementation, launched at `started_ms`.
function running(number: number, started_ms = NOW - ELAPSED): BoardRow {
	const status = {
		state: 'running' as const,
		track: ['implement' as const],
		phase_ms: NOW - ELAPSED,
		started_ms,
	}

	return { number, title: undefined, kind: undefined, state: 'running', status, waits: [] }
}

function read_of(row: BoardRow): EstimateRead {
	const layout = { ...EMPTY_LAYOUT, active: [row] }

	return { now_ms: NOW, ended_ms: undefined, layout, lane_totals: TOTALS, lane_bands: BANDS }
}

// How long after now `issue`'s running row should finish.
function left_of(issue: number): number | undefined {
	const row = running(issue)
	const finish = run_board_estimate.row_finish(row, read_of(row))

	return finish === undefined ? undefined : finish.finish_ms - NOW
}

describe('run_board_estimate.row_finish by the declared size’s band', () => {
	it('finishes a large row later than a small one', () => {
		expect(left_of(1)).toBe(LARGE - ELAPSED)
		expect(left_of(2)).toBe(SMALL - ELAPSED)
	})

	it('reads the whole totals for a row whose band has too few lanes', () => {
		// 15′, 25′ and 35′ beyond 5′.
		expect(left_of(3)).toBe(25 * MINUTE)
	})

	it('reads the whole totals for a row with no declared size', () => {
		expect(left_of(4)).toBe(25 * MINUTE)
	})

	it('draws no drift for a large row just launched', () => {
		const row = running(1, NOW)

		expect(run_board_estimate.row_finish(row, read_of(row))?.drift_ms).toBe(0)
	})
})
