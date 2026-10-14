import { describe, expect, it } from 'vitest'
import type { BoardRow } from './run-board-layout'
import { run_board_row_yield } from './run-board-row-yield'
import type { ItemState, ItemStatus } from './run-board-status'

// joshuafolkken/kit#3505: the stage an issue row gives way in when the pane is short, and its age.

const STARTED = 1000
const ENDED = 2000

function row(state: ItemState, status: ItemStatus | undefined): BoardRow {
	return { number: 1, title: undefined, kind: undefined, state, status, waits: [] }
}

describe('run_board_row_yield.yield_of', () => {
	it.each([
		['merged', 'finished'],
		['done', 'finished'],
		['waiting', 'pending'],
		['human', 'pending'],
		['parked', 'parked'],
		['stopped', 'parked'],
		['running', 'running'],
	] as const)('places a %s row in the %s stage', (state, stage) => {
		expect(run_board_row_yield.yield_of(row(state, undefined)).stage).toBe(stage)
	})

	it('ages a running row by its start even when it has an end', () => {
		const status: ItemStatus = { state: 'running', started_ms: STARTED, ended_ms: ENDED }

		expect(run_board_row_yield.yield_of(row('running', status)).at_ms).toBe(STARTED)
	})

	it('ages a settled row by its end, or its start where it has none', () => {
		const ended: ItemStatus = { state: 'merged', started_ms: STARTED, ended_ms: ENDED }
		const unended: ItemStatus = { state: 'merged', started_ms: STARTED }

		expect(run_board_row_yield.yield_of(row('merged', ended)).at_ms).toBe(ENDED)
		expect(run_board_row_yield.yield_of(row('merged', unended)).at_ms).toBe(STARTED)
	})

	it('has no age for a row with no status', () => {
		expect(run_board_row_yield.yield_of(row('waiting', undefined)).at_ms).toBeUndefined()
	})
})
