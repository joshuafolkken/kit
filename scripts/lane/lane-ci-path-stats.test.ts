import { describe, expect, it } from 'vitest'
import { lane_ci_path_stats } from './lane-ci-path-stats'
import type { LedgerEntry } from './lane-ledger'
import { lane_stats } from './lane-stats'

// joshuafolkken/kit#5295: the period's `ci-wait` rows reduce to one row per check that settled last —
// how often, and the median and maximum of when it settled.

const NOW = Date.parse('2026-10-28T12:00:00.000Z')
const AT = new Date(NOW).toISOString()
const WINDOW = lane_stats.window_of(1, NOW)
const ISSUE = 5295

function ci_wait(
	last_check: string,
	check_ms: Record<string, number>,
	issue?: number,
): LedgerEntry {
	return {
		kind: 'stage',
		at: AT,
		stage: 'ci-wait',
		elapsed_ms: 200_000,
		last_check,
		check_ms,
		...(issue !== undefined && { issue }),
	}
}

function rows_of(entries: ReadonlyArray<LedgerEntry>): Array<string> {
	return lane_ci_path_stats.table(entries, WINDOW).split('\n').slice(2)
}

describe('lane_ci_path_stats.table', () => {
	it('heads the table with the critical-path columns', () => {
		expect(lane_ci_path_stats.table([], WINDOW).split('\n', 1)[0]).toBe(
			'| followup critical path | runs | median (s) | max (s) |',
		)
	})

	it('counts each last check with the median and maximum of when it settled', () => {
		const entries = [
			ci_wait('e2e', { e2e: 100_000, lint: 20_000 }),
			ci_wait('e2e', { e2e: 300_000 }),
			ci_wait('e2e', { e2e: 200_000 }),
			ci_wait('lint', { lint: 50_000 }),
		]

		expect(rows_of(entries)).toStrictEqual([
			'| e2e | 3 | 200.0 | 300.0 |',
			'| lint | 1 | 50.0 | 50.0 |',
		])
	})

	it('leaves out a ci-wait row that names no last check and every other stage', () => {
		const legacy: LedgerEntry = { kind: 'stage', at: AT, stage: 'ci-wait', elapsed_ms: 1 }
		const other: LedgerEntry = {
			kind: 'stage',
			at: AT,
			stage: 'coderabbit-wait',
			elapsed_ms: 1,
			last_check: 'e2e',
			check_ms: { e2e: 1 },
		}

		expect(rows_of([legacy, other])).toStrictEqual([])
	})
})

describe('lane_ci_path_stats.last_check_text', () => {
	it("names the last check of the lane's latest ci-wait row", () => {
		const entries = [
			ci_wait('lint', { lint: 10_000 }, ISSUE),
			ci_wait('e2e', { e2e: 90_000 }, ISSUE),
			ci_wait('build', { build: 5000 }, ISSUE + 1),
		]

		expect(lane_ci_path_stats.last_check_text(entries, ISSUE)).toBe(' (last check: e2e 90.0s)')
	})

	it('is empty where the lane has no ci-wait row naming one', () => {
		expect(lane_ci_path_stats.last_check_text([ci_wait('e2e', { e2e: 1 })], ISSUE)).toBe('')
	})
})
