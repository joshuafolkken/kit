import { describe, expect, it } from 'vitest'
import { run_board_paused } from './run-board-paused'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#4198: a lane whose processes are all stopped (`T`) is paused, a zombie left out and
// one process still running keeping it running; a paused lane's running row is drawn paused, timed
// until it was first seen so.

const { paused_lanes, paused_over, paused_since } = run_board_paused
const LANE = '4198'
const OTHER = '4197'
const STARTED = 1000
const FIRST_SEEN = 5000
const LATER = 9000

function listed(...stats: Array<string>): Map<number, { stat: string }> {
	return new Map(stats.map((stat, index) => [index + 1, { stat }]))
}

function in_lane(count: number, lane: string = LANE): Map<number, string | undefined> {
	return new Map(Array.from({ length: count }, (_, index) => [index + 1, lane]))
}

describe('run_board_paused.paused_lanes', () => {
	it.each([
		['every process stopped', ['T', 'T+', 'TN'], true],
		['a zombie beside the stopped ones', ['T', 'Z'], true],
		['one process still sleeping', ['T', 'S+'], false],
		['one process running', ['R', 'T'], false],
		['only a zombie', ['Z'], false],
	])('reads %s', (_label, stats, is_paused) => {
		expect(paused_lanes(listed(...stats), in_lane(stats.length)).has(LANE)).toBe(is_paused)
	})

	it('leaves a process in no lane, or in another lane, out of the lane', () => {
		const lanes = new Map([
			[1, LANE],
			[2, undefined],
			[3, OTHER],
		])

		expect(paused_lanes(listed('T', 'S', 'S'), lanes)).toStrictEqual(new Set([LANE]))
	})
})

describe('run_board_paused.paused_since', () => {
	it('keeps when a lane was first seen paused, and drops one no longer paused', () => {
		const earlier = new Map([
			[LANE, FIRST_SEEN],
			[OTHER, FIRST_SEEN],
		])

		expect(paused_since(earlier, new Set([LANE, '4199']), LATER)).toStrictEqual(
			new Map([
				[LANE, FIRST_SEEN],
				['4199', LATER],
			]),
		)
		expect(paused_since(undefined, new Set([LANE]), LATER)).toStrictEqual(new Map([[LANE, LATER]]))
	})
})

describe('run_board_paused.paused_over', () => {
	const running: ItemStatus = { state: 'running', started_ms: STARTED, lane: `lane ${LANE}` }
	const merged: ItemStatus = { state: 'merged', started_ms: STARTED, ended_ms: LATER }

	it('draws a running row paused, timed until first seen so', () => {
		const statuses = new Map([[Number(LANE), running]])

		expect(paused_over(statuses, new Map([[LANE, FIRST_SEEN]])).get(Number(LANE))).toStrictEqual({
			...running,
			state: 'paused',
			ended_ms: FIRST_SEEN,
		})
	})

	it('leaves a settled row, and a running row whose lane is not paused, as they were', () => {
		const statuses = new Map([
			[Number(LANE), merged],
			[Number(OTHER), running],
		])

		expect(paused_over(statuses, new Map([[LANE, FIRST_SEEN]]))).toStrictEqual(statuses)
		expect(paused_over(statuses, undefined)).toBe(statuses)
	})
})
