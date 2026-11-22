import { describe, expect, it } from 'vitest'
import { run_board_layout_order } from './run-board-layout-order'
import type { BoardRow, RowReason } from './run-board-layout-types'
import type { ItemState, ItemStatus } from './run-board-status'

// The order the board's rows are drawn in: the touched rows by state then time, the unreached rows by
// the start time they wait on.

const EARLY_MS = 1000
const LATE_MS = 2000

function row_of(number: number, state: ItemState, status: Partial<ItemStatus> = {}): BoardRow {
	return {
		number,
		title: undefined,
		kind: undefined,
		state,
		status: { state, ...status },
		waits: [],
	}
}

// A waiting row held back until `not_before_ms`.
function waiting_from(number: number, not_before_ms: number): BoardRow {
	const reason: RowReason = { not_before_ms }

	return { reason, ...row_of(number, 'waiting') }
}

function numbers_of(rows: ReadonlyArray<BoardRow>): Array<number> {
	return rows.map((row) => row.number)
}

describe('run_board_layout_order.active_order', () => {
	it('draws the running rows first, then the parked and stopped ones, then the finished ones', () => {
		const rows = [
			row_of(1, 'merged', { ended_ms: EARLY_MS }),
			row_of(2, 'parked', { started_ms: EARLY_MS }),
			row_of(3, 'running', { started_ms: LATE_MS }),
		]

		expect(numbers_of(rows.toSorted(run_board_layout_order.active_order))).toEqual([3, 2, 1])
	})

	it('orders unfinished rows by their start, one with none last', () => {
		const rows = [
			row_of(1, 'running'),
			row_of(2, 'running', { started_ms: LATE_MS }),
			row_of(3, 'running', { started_ms: EARLY_MS }),
		]

		expect(numbers_of(rows.toSorted(run_board_layout_order.active_order))).toEqual([3, 2, 1])
	})

	it('places a row with no status after a started one, whichever side each is on', () => {
		const started = row_of(1, 'running', { started_ms: EARLY_MS })
		const unread = { ...row_of(2, 'running'), status: undefined }

		expect(run_board_layout_order.active_order(started, unread)).toBe(-1)
		expect(run_board_layout_order.active_order(unread, started)).toBe(1)
	})

	it('orders finished rows from the newest end, one with none last', () => {
		const rows = [
			row_of(1, 'done'),
			row_of(2, 'merged', { ended_ms: EARLY_MS }),
			row_of(3, 'withdrawn', { ended_ms: LATE_MS }),
		]

		expect(numbers_of(rows.toSorted(run_board_layout_order.active_order))).toEqual([3, 2, 1])
	})
})

describe('run_board_layout_order.start_order', () => {
	it('keeps a row waiting on no start time ahead, then the earliest start first', () => {
		const rows = [waiting_from(1, LATE_MS), waiting_from(2, EARLY_MS), row_of(3, 'waiting')]

		expect(numbers_of(rows.toSorted(run_board_layout_order.start_order))).toEqual([3, 2, 1])
	})

	it('places a row with a start time after one with none, whichever side each is on', () => {
		const dated = waiting_from(1, EARLY_MS)
		const undated = row_of(2, 'waiting')

		expect(run_board_layout_order.start_order(dated, undated)).toBe(1)
		expect(run_board_layout_order.start_order(undated, dated)).toBe(-1)
	})
})

describe('run_board_layout_order.is_finished / is_settled', () => {
	it.each<ItemState>(['merged', 'done', 'already_done', 'withdrawn'])(
		'counts %s as finished and settled',
		(state) => {
			expect(run_board_layout_order.is_finished(state)).toBe(true)
			expect(run_board_layout_order.is_settled(state)).toBe(true)
		},
	)

	it('counts a parked row as settled but not finished', () => {
		expect(run_board_layout_order.is_finished('parked')).toBe(false)
		expect(run_board_layout_order.is_settled('parked')).toBe(true)
	})

	it('counts a running row as neither', () => {
		expect(run_board_layout_order.is_finished('running')).toBe(false)
		expect(run_board_layout_order.is_settled('running')).toBe(false)
	})
})
