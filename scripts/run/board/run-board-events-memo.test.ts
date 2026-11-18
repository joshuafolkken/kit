import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it, vi } from 'vitest'
import { run_board_events_memo, type EventsMemo } from './run-board-events-memo'

// joshuafolkken/kit#4267: a fold keyed on the events array runs once per read, not per redraw.

const EVENT: RunEvent = { pos: 1, at: '2026-10-20T09:00:00.000Z', kind: 'merge', text: '#1 merged' }

function count(events: ReadonlyArray<RunEvent>): number {
	return events.length
}

describe('run_board_events_memo.remembered', () => {
	it('folds the same array once and hands back what it kept', () => {
		const memo: EventsMemo<number> = new WeakMap()
		const fold = vi.fn(count)
		const events = [EVENT]

		expect(run_board_events_memo.remembered(memo, events, fold)).toBe(1)
		expect(run_board_events_memo.remembered(memo, events, fold)).toBe(1)
		expect(fold).toHaveBeenCalledOnce()
	})

	it('folds a new array afresh', () => {
		const memo: EventsMemo<number> = new WeakMap()
		const fold = vi.fn(count)

		run_board_events_memo.remembered(memo, [EVENT], fold)

		expect(run_board_events_memo.remembered(memo, [EVENT, EVENT], fold)).toBe(2)
		expect(fold).toHaveBeenCalledTimes(2)
	})
})
