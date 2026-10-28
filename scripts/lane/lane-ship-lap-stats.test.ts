import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_ship_lap_stats } from './lane-ship-lap-stats'
import { lane_stats } from './lane-stats'
import { lane_value_cell } from './lane-value-cell'

// joshuafolkken/kit#5294: one period's ship laps reduce to a row per stage and step — median, maximum
// and runs — in the stages' running order, a stage's steps longest first.

const NOW = Date.parse('2026-10-28T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const ISSUE = 5294
const GATE = 'gate'
const JOSH_GATE = 'josh gate'
const SCOPED_PAIR = 'scoped pair'
const GATE_JOSH_GATE_ROW = 'gate: josh gate'
const GATE_SCOPED_PAIR_ROW = 'gate: scoped pair'

function lap(stage: string, step: string, minutes: number): LedgerEntry {
	return {
		kind: 'ship-lap',
		at: new Date(NOW - MS_PER_MINUTE).toISOString(),
		issue: ISSUE,
		stage,
		step,
		elapsed_ms: minutes * MS_PER_MINUTE,
	}
}

function rows_of(entries: ReadonlyArray<LedgerEntry>): Array<Array<string>> {
	return lane_ship_lap_stats
		.table(entries, WINDOW)
		.split('\n')
		.slice(2)
		.map((line) => line.slice(2, -2).split(' | '))
}

describe('lane_ship_lap_stats.table', () => {
	it('prints the header alone when no lap was recorded', () => {
		expect(lane_ship_lap_stats.table([], WINDOW).split('\n', 1)[0]).toBe(
			'| ship step | median (min) | max (min) | runs |',
		)
		expect(rows_of([])).toStrictEqual([])
	})

	it('reduces each stage and step to its median, maximum and runs', () => {
		const entries = [lap(GATE, JOSH_GATE, 2), lap(GATE, JOSH_GATE, 4), lap(GATE, JOSH_GATE, 9)]

		expect(rows_of(entries)).toStrictEqual([[GATE_JOSH_GATE_ROW, '4.0', '9.0', '3']])
	})

	it("orders the rows by the stages' running order, a stage's steps longest first", () => {
		const entries = [
			lap('commit', 'josh git', 1),
			lap(GATE, SCOPED_PAIR, 1),
			lap('sync', 'overlap wait', 3),
			lap(GATE, JOSH_GATE, 5),
		]

		expect(rows_of(entries).map(([first]) => first)).toStrictEqual([
			'sync: overlap wait',
			GATE_JOSH_GATE_ROW,
			GATE_SCOPED_PAIR_ROW,
			'commit: josh git',
		])
	})

	// `lane:value cell` finds a row by its first cell alone, so a step recorded in two stages stays apart.
	it('reads one step of one stage through lane:value cell', () => {
		const entries = [lap(GATE, SCOPED_PAIR, 2), lap('review', SCOPED_PAIR, 6)]
		const address = { table: 'ship step', row: GATE_SCOPED_PAIR_ROW, column: 'median (min)' }

		expect(lane_value_cell.value([lane_ship_lap_stats.table(entries, WINDOW)], address)).toBe(2)
	})
})
