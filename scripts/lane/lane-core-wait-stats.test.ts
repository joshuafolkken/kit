import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { describe, expect, it } from 'vitest'
import { lane_core_wait_stats } from './lane-core-wait-stats'
import type { LedgerEntry } from './lane-ledger'
import { lane_stats } from './lane-stats'

// joshuafolkken/kit#4382: one ledger period reduces to a row per lane — how long its commands waited
// for the core budget, so a lane's time splits into work and waiting.

const NOW = Date.parse('2026-10-21T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const LONG_AGO_MINUTES = 3000

function core_wait(waited_minutes: number, issue?: number, minutes_before = 1): LedgerEntry {
	const wait = {
		kind: 'core-wait' as const,
		at: new Date(NOW - minutes_before * MS_PER_MINUTE).toISOString(),
		command: 'lint',
		waited_ms: waited_minutes * MS_PER_MINUTE,
	}

	return issue === undefined ? wait : { ...wait, issue }
}

function lines_of(entries: ReadonlyArray<LedgerEntry>, is_all = false): Array<string> {
	return lane_core_wait_stats.table(entries, WINDOW, { is_all }).split('\n')
}

// One wait per lane, the lane numbered by its rank: lane 1 waited longest.
function lanes(count: number): Array<LedgerEntry> {
	return Array.from({ length: count }, (_, index) => core_wait(count - index, index + 1))
}

// joshuafolkken/kit#7578: a period of hundreds of lanes overflowed a session's output cap.
describe('lane_core_wait_stats.table row cap', () => {
	const { LANE_ROWS } = lane_core_wait_stats

	it('prints every lane when the period has no more than LANE_ROWS', () => {
		expect(lines_of(lanes(LANE_ROWS))).toHaveLength(LANE_ROWS + 2)
	})

	it('prints the first LANE_ROWS lanes and a count of the rest past it', () => {
		const lines = lines_of(lanes(LANE_ROWS + 3))

		expect(lines.slice(2, -2).map((line) => line.split(' | ', 1)[0])).toStrictEqual(
			Array.from({ length: LANE_ROWS }, (_, index) => `| ${String(index + 1)}`),
		)
		expect(lines.at(-1)).toBe('… 3 more rows omitted — `--all` prints every row')
	})

	it('prints every lane with --all', () => {
		expect(lines_of(lanes(LANE_ROWS + 3), true)).toHaveLength(LANE_ROWS + 3 + 2)
	})
})

describe('lane_core_wait_stats.table', () => {
	it('sums each lane’s waits, the longest total first', () => {
		const entries = [core_wait(1, 7), core_wait(3, 9), core_wait(2, 7), core_wait(4, 9)]

		expect(lines_of(entries).slice(2)).toStrictEqual([
			'| 9 | 7.0 | 3.5 | 2 |',
			'| 7 | 3.0 | 1.5 | 2 |',
		])
	})

	it('puts a wait outside a lane on its own row', () => {
		expect(lines_of([core_wait(2)])[2]).toBe('| outside a lane | 2.0 | 2.0 | 1 |')
	})

	it('prints a none row for a period with no wait, the ones before it left out', () => {
		const lines = lines_of([core_wait(5, 7, LONG_AGO_MINUTES)])

		expect(lines[0]).toBe('| lane | total (min) | median (min) | waits |')
		expect(lines[2]).toBe('| none | not measured | not measured | 0 |')
	})
})
