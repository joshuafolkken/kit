import { describe, expect, it } from 'vitest'
import { run_board_settle } from './run-board-settle'
import { run_board_status, type ItemStatus, type OpenRead } from './run-board-status'

const ISSUE = 7389
const OUTCOME = {
	summary: 'No redundant hops found',
	url: 'https://github.com/joshuafolkken/kit/issues/7389#issuecomment-6818718015',
}
const CLOSED = {
	title: 'Investigation',
	labels: [],
	closed_ms: 1,
	is_merged: false,
	is_not_planned: true,
	outcome: OUTCOME,
}
const READ: OpenRead = {
	open_numbers: new Set(),
	read_ms: 1,
	closed: new Map([[ISSUE, CLOSED]]),
	labels: new Map(),
}

describe('run_board_status — outcome propagation', () => {
	it.each(['running', 'withdrawn', 'parked'] as const)(
		'carries the evidence past a generic %s management reason',
		(state) => {
			const status: ItemStatus = { state, started_ms: 0, reason: 'its issue was closed' }
			const actual = run_board_status.settle_closed(new Map([[ISSUE, status]]), READ).get(ISSUE)

			expect(actual).toMatchObject({ state: 'withdrawn', outcome: OUTCOME })
		},
	)

	it('keeps an outcome when an ending event settles the same attempt again', () => {
		expect(
			run_board_settle.settled_as({ state: 'done', outcome: OUTCOME }, 'withdrawn'),
		).toMatchObject({ state: 'withdrawn', outcome: OUTCOME })
	})

	it.each(['running', 'done', 'already_done', 'withdrawn'] as const)(
		'does not attach an earlier close to a relaunched %s attempt',
		(state) => {
			const status: ItemStatus = { state, started_ms: 2 }

			expect(
				run_board_status.settle_closed(new Map([[ISSUE, status]]), READ).get(ISSUE),
			).toStrictEqual(status)
		},
	)

	it.each(['running', 'done', 'already_done', 'withdrawn'] as const)(
		'uses the newest launch to isolate a %s attempt from an earlier close',
		(state) => {
			const status: ItemStatus = { state, started_ms: 0, launched_ms: 2 }

			expect(
				run_board_status.settle_closed(new Map([[ISSUE, status]]), READ).get(ISSUE),
			).toStrictEqual(status)
		},
	)
})
