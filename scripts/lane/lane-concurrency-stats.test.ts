import { describe, expect, it } from 'vitest'
import { lane_concurrency_stats } from './lane-concurrency-stats'
import type { LedgerEntry } from './lane-ledger'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats } from './lane-stats'
import type { ToolCall } from './lane-transcript-calls'

// joshuafolkken/kit#7025: `lane:stats` splits the solo `lint:related` / `test:related` calls by the
// lanes the latest load sample before each call counted — runs and median seconds per lane count.

const NOW = Date.parse('2026-11-10T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const SECOND = 1000
const MINUTE = 60_000
const HOUR = 3_600_000
const STALE_MINUTES = 10
const SAMPLE_MAX_AGE_MINUTES = 5
const LINT = 'pnpm josh lint:related'
const TEST = 'pnpm josh test:related'
const { NOT_MEASURED } = lane_stage_stats

function sample(lanes: number, at_ms: number): LedgerEntry {
	return { kind: 'load', at: new Date(at_ms).toISOString(), load: 1, lanes }
}

function call(command: string, started_ms: number, seconds: number): ToolCall {
	return {
		session_id: 'one',
		lane: 'lane-1',
		started_ms,
		duration_ms: seconds * SECOND,
		tool: 'Bash',
		background: false,
		command,
		subagent: undefined,
		output: '',
	}
}

// The table's rows below its header and separator, each without its edge pipes.
function rows_of(
	entries: ReadonlyArray<LedgerEntry>,
	calls: ReadonlyArray<ToolCall>,
): Array<string> {
	return lane_concurrency_stats
		.table(entries, calls, WINDOW)
		.split('\n')
		.slice(2)
		.map((line) => line.slice(2, -2))
}

describe('lane_concurrency_stats.table', () => {
	it('gives each lane count its runs and median seconds per command', () => {
		const solo = NOW - HOUR
		const busy = NOW - 2 * HOUR
		const entries = [sample(1, solo - MINUTE), sample(6, busy - MINUTE)]
		const calls = [
			call(LINT, solo, 30),
			call(TEST, solo, 20),
			call(TEST, solo, 40),
			call(LINT, busy, 90),
			call(LINT, busy, 70),
		]

		expect(rows_of(entries, calls)).toStrictEqual([
			'1 | 1 | 30.0 | 2 | 30.0',
			`6 | 2 | 80.0 | 0 | ${NOT_MEASURED}`,
		])
	})

	it('leaves out a call with no recent sample before it and a chained call', () => {
		const started = NOW - HOUR
		const entries = [sample(3, started - STALE_MINUTES * MINUTE), sample(2, started + MINUTE)]
		const calls = [call(LINT, started, 30), call(`${LINT} && ${TEST}`, started + 2 * MINUTE, 60)]

		expect(rows_of(entries, calls)).toStrictEqual([])
	})

	it('keeps a call whose sample is exactly the age limit old and leaves out one a minute older', () => {
		const kept = NOW - HOUR
		const dropped = NOW - 2 * HOUR
		const entries = [
			sample(4, kept - SAMPLE_MAX_AGE_MINUTES * MINUTE),
			sample(2, dropped - (SAMPLE_MAX_AGE_MINUTES + 1) * MINUTE),
		]
		const calls = [call(TEST, kept, 50), call(TEST, dropped, 50)]

		expect(rows_of(entries, calls)).toStrictEqual([`4 | 0 | ${NOT_MEASURED} | 1 | 50.0`])
	})
})
