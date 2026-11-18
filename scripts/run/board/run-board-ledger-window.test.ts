import path from 'node:path'
import { lane_held_stats } from '#scripts/lane/lane-held-stats'
import { lane_ledger, type LedgerEntry } from '#scripts/lane/lane-ledger'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_lane_totals } from './run-board-lane-totals'
import { run_board_ledger_window } from './run-board-ledger-window'
import { run_board_usual } from './run-board-usual'

// joshuafolkken/kit#7932: the board reads the ledger's recent window, and its usual times, lane totals
// and open hold come out as the whole ledger's would.

const make_directory = temporary_directory('suite')
const scratch = make_directory('run-board-ledger-window-test-')
const NOW = Date.parse('2026-11-19T00:00:00.000Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const SHIP_STAGES = [
	'preflight',
	'review',
	'gate',
	'sync',
	'commit',
	'round-2',
	'followup',
	'report',
]
const STAGE_AT = 30 * MINUTE
const STAGE_MS = 5 * MINUTE

function iso(ms: number): string {
	return new Date(ms).toISOString()
}

// One lane dispatched at `dispatched_ms`: its ship stages, then — `merged_ms` after — its merge.
function lane(
	issue: number,
	dispatched_ms: number,
	stages = SHIP_STAGES,
	merged_ms = HOUR,
): Array<object> {
	return [
		{ kind: 'dispatch', at: iso(dispatched_ms), issue },
		...stages.map((stage, index) => ({
			kind: 'stage',
			at: iso(dispatched_ms + STAGE_AT + index * MINUTE),
			stage,
			elapsed_ms: STAGE_MS + issue * MINUTE,
			issue,
		})),
		{ kind: 'merge', at: iso(dispatched_ms + merged_ms), issue },
	]
}

function held(at_ms: number, reason: string): object {
	return { kind: 'held', at: iso(at_ms), reason }
}

function ledger_of(name: string, lines: ReadonlyArray<object>): string {
	const file = path.join(scratch, `${name}.jsonl`)

	for (const line of lines) lane_ledger_write.append(file, line)

	return file
}

function results_of(entries: ReadonlyArray<LedgerEntry>): object {
	return {
		usual: [...run_board_usual.usual_of(entries, NOW)],
		totals: run_board_lane_totals.totals_of(entries, NOW),
		hold: lane_held_stats.open_reason(entries, NOW),
	}
}

// The window's results beside the whole ledger's, and whether the window fell back to the whole read.
function compare(file: string): { window: object; whole: object; fell_back: boolean } {
	const whole = results_of(lane_ledger.read_entries(file))
	const read = vi.spyOn(lane_ledger, 'read_entries')
	const window = results_of(run_board_ledger_window.entries_of(file, NOW))

	return { window, whole, fell_back: read.mock.calls.length > 0 }
}

describe('run_board_ledger_window.entries_of', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('reads only the window when it measures every stage and lane', () => {
		const file = ledger_of('covered', [
			...lane(1, NOW - 10 * DAY),
			held(NOW - 5 * DAY, 'old'),
			...lane(2, NOW - DAY),
			...lane(3, NOW - 2 * DAY),
			held(NOW - 10 * MINUTE, 'memory'),
		])
		const { window, whole, fell_back } = compare(file)

		expect(window).toStrictEqual(whole)
		expect(fell_back).toBe(false)
		expect(whole).toHaveProperty('hold', 'memory')
	})

	it('gives the whole ledger’s open hold when the last hold end precedes the window', () => {
		const file = ledger_of('old-hold', [...lane(1, NOW - 10 * DAY), held(NOW - 4 * DAY, 'old')])
		const { window, whole } = compare(file)

		expect(window).toStrictEqual(whole)
		expect(whole).toHaveProperty('hold', undefined)
	})
})

describe('run_board_ledger_window.entries_of falling back', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('falls back to the whole ledger when a stage is measured only before the window', () => {
		const file = ledger_of('stage-fill', [
			...lane(1, NOW - 10 * DAY),
			...lane(2, NOW - DAY, SHIP_STAGES.slice(0, -1)),
		])
		const { window, whole, fell_back } = compare(file)

		expect(window).toStrictEqual(whole)
		expect(fell_back).toBe(true)
	})

	it('falls back to the whole ledger when the window is empty', () => {
		const file = ledger_of('empty', [...lane(1, NOW - 10 * DAY), held(NOW - 9 * DAY, 'old')])
		const { window, whole, fell_back } = compare(file)

		expect(window).toStrictEqual(whole)
		expect(fell_back).toBe(true)
	})

	it('falls back to the whole ledger when a merge in the window was dispatched before it', () => {
		const file = ledger_of('early-dispatch', [
			...lane(1, NOW - 3 * DAY - HOUR, SHIP_STAGES, 2 * HOUR),
			...lane(2, NOW - DAY),
		])
		const { window, whole, fell_back } = compare(file)

		expect(window).toStrictEqual(whole)
		expect(fell_back).toBe(true)
	})
})
