import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import type { DispatchRecord } from './lane-ledger-schema-dispatch'
import { lane_model_stats } from './lane-model-stats'
import { lane_stats } from './lane-stats'

// joshuafolkken/kit#8815: one period's dispatches reduce to one row per implement model and reason,
// with the lanes dispatched on it and how many of them merged.

const NOW = Date.parse('2026-11-23T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const OUTSIDE_MINUTES = 2 * 24 * 60
const HEADER = ['| model | reason | dispatched lanes | merged |', '| --- | --- | --- | --- |']

function at(minutes_before: number): string {
	return new Date(NOW - minutes_before * MS_PER_MINUTE).toISOString()
}

function dispatch(record: DispatchRecord, minutes_before = 10): LedgerEntry {
	return { kind: 'dispatch', at: at(minutes_before), ...record }
}

function merge(issue: number, minutes_before = 5): LedgerEntry {
	return { kind: 'merge', at: at(minutes_before), issue }
}

function rows_of(entries: ReadonlyArray<LedgerEntry>): Array<string> {
	return lane_model_stats.table(entries, WINDOW).split('\n').slice(HEADER.length)
}

describe('lane_model_stats.table', () => {
	it('prints only the header for a period with no dispatch', () => {
		expect(lane_model_stats.table([], WINDOW).split('\n')).toStrictEqual(HEADER)
	})

	it('counts the lanes per model and reason and the ones that merged', () => {
		const entries = [
			dispatch({ issue: 1, model: 'opus', reason: 'default' }),
			dispatch({ issue: 2, model: 'opus', reason: 'default' }),
			dispatch({ issue: 3, model: 'sonnet', reason: 'label' }),
			merge(1),
			merge(3),
		]

		expect(rows_of(entries)).toStrictEqual([
			'| opus | default | 2 | 1 |',
			'| sonnet | label | 1 | 1 |',
		])
	})

	it('counts a dispatch row without a model or reason under unrecorded', () => {
		expect(rows_of([dispatch({ issue: 1 })])).toStrictEqual(['| unrecorded | unrecorded | 1 | 0 |'])
	})

	it('counts a lane dispatched twice on the same model once', () => {
		const record: DispatchRecord = { issue: 1, model: 'opus', reason: 'environment' }

		expect(rows_of([dispatch(record, 20), dispatch(record)])).toStrictEqual([
			'| opus | environment | 1 | 0 |',
		])
	})
})

describe('lane_model_stats.table — repeated dispatches and the period', () => {
	it('counts a routed lane re-dispatched on its stored label once, under route', () => {
		const entries = [
			dispatch({ issue: 1, model: 'sonnet', reason: 'route' }, 20),
			dispatch({ issue: 1, model: 'sonnet', reason: 'label' }),
			merge(1),
		]

		expect(rows_of(entries)).toStrictEqual(['| sonnet | route | 1 | 1 |'])
	})

	it('leaves out a dispatch from before the period but counts a merge from any time', () => {
		const entries = [
			dispatch({ issue: 1, model: 'opus', reason: 'label' }, OUTSIDE_MINUTES),
			dispatch({ issue: 2, model: 'opus', reason: 'label' }),
			merge(2, OUTSIDE_MINUTES),
		]

		expect(rows_of(entries)).toStrictEqual(['| opus | label | 1 | 1 |'])
	})
})
