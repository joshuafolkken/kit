import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import { describe, expect, it } from 'vitest'
import { lane_ledger, type LedgerEntry } from './lane-ledger'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats } from './lane-stats'
import type { ToolCall } from './lane-transcript-calls'
import { lane_turn_stats } from './lane-turn-stats'
import { lane_value_cell } from './lane-value-cell'

// joshuafolkken/kit#6209: each lane's transcript calls are counted by the ledger stage their start
// falls in, and the table prints the median over the period's lanes that have a transcript.

const NOW = Date.parse('2026-11-04T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const BASE_MS = NOW - 100 * MS_PER_MINUTE
const TABLE = 'stage turns'
const CALLS = 'calls per lane (median)'
const STOPS = 'stops per lane (median)'
const LANES = 'lanes'
const NO_TRANSCRIPT = 'no transcript'
const BETWEEN = 'between stages'
const LANE_A = 6001
const LANE_B = 6002
const LANE_C = 6003
const { STAGE } = run_ship_stage

function at(minute: number): string {
	return new Date(BASE_MS + minute * MS_PER_MINUTE).toISOString()
}

function dispatch(issue: number): LedgerEntry {
	return { kind: lane_ledger.KIND.DISPATCH, at: at(0), issue }
}

function stop(issue: number, reason: string, minute = 1): LedgerEntry {
	return { kind: lane_ledger.KIND.STOP, at: at(minute), issue, reason }
}

// A stage of `issue` from minute `from` to minute `to`.
function stage(issue: number, name: string, from: number, to: number): LedgerEntry {
	const elapsed_ms = (to - from) * MS_PER_MINUTE

	return { kind: lane_ledger.KIND.STAGE, at: at(to), stage: name, elapsed_ms, issue }
}

function call(issue: number, minute: number): ToolCall {
	return {
		session_id: `session-${String(issue)}`,
		lane: `/home/.claude/projects/-kit-lanes-${String(issue)}`,
		started_ms: BASE_MS + minute * MS_PER_MINUTE,
		duration_ms: MS_PER_MINUTE,
		tool: 'Bash',
		background: false,
		command: undefined,
		subagent: undefined,
		output: '',
	}
}

// Lane A: implement 2, preflight 1, between 1, followup 1, ci-wait 1 — lane B: implement 3,
// preflight 1 — lane C: dispatched, no transcript.
const ENTRIES: ReadonlyArray<LedgerEntry> = [
	dispatch(LANE_A),
	dispatch(LANE_B),
	dispatch(LANE_C),
	stage(LANE_A, STAGE.PREFLIGHT, 10, 12),
	stage(LANE_A, STAGE.FOLLOWUP, 20, 40),
	stage(LANE_A, lane_ledger.CI_WAIT_STAGE, 25, 35),
	stage(LANE_B, STAGE.PREFLIGHT, 4, 6),
]
const LANE_CALLS: ReadonlyArray<ToolCall> = [
	...[1, 5, 11, 15, 22, 30].map((minute) => call(LANE_A, minute)),
	...[1, 2, 3, 5].map((minute) => call(LANE_B, minute)),
]

function cell(row: string, column: string = CALLS): number | undefined {
	const table = lane_turn_stats.table(ENTRIES, LANE_CALLS, WINDOW)

	return lane_value_cell.value([table], { table: TABLE, column, row })
}

describe('lane_turn_stats.table', () => {
	it('prints the median calls per lane of each stage over two lanes', () => {
		expect(cell(lane_stage_stats.IMPLEMENT)).toBe(2.5)
		expect(cell(STAGE.PREFLIGHT)).toBe(1)
		expect(cell(STAGE.FOLLOWUP)).toBe(0.5)
		expect(cell(lane_ledger.CI_WAIT_STAGE)).toBe(0.5)
		expect(cell(BETWEEN)).toBe(0.5)
	})

	it('leaves a lane with no transcript out of the medians and counts it', () => {
		expect(cell(STAGE.PREFLIGHT, LANES)).toBe(2)
		expect(cell(NO_TRANSCRIPT, LANES)).toBe(1)
	})

	it('counts the calls of a lane no ship stage followed yet as implement', () => {
		const running = [dispatch(LANE_C)]
		const table = lane_turn_stats.table(running, [call(LANE_C, 1), call(LANE_C, 2)], WINDOW)
		const address = { table: TABLE, column: CALLS }

		expect(lane_value_cell.value([table], { ...address, row: lane_stage_stats.IMPLEMENT })).toBe(2)
		expect(lane_value_cell.value([table], { ...address, row: BETWEEN })).toBe(0)
	})

	it('prints not measured when no lane has a transcript', () => {
		const table = lane_turn_stats.table(ENTRIES, [], WINDOW)

		expect(table).toContain(`| ${STAGE.PREFLIGHT} | ${lane_stage_stats.NOT_MEASURED} | 0 | 0 |`)
		expect(
			lane_value_cell.value([table], { table: TABLE, column: LANES, row: NO_TRANSCRIPT }),
		).toBe(3)
	})
})

const STOP_ENTRIES: ReadonlyArray<LedgerEntry> = [
	dispatch(LANE_A),
	dispatch(LANE_B),
	stop(LANE_A, STAGE.PREFLIGHT),
	stop(LANE_A, STAGE.PREFLIGHT),
	stop(LANE_B, STAGE.PREFLIGHT),
	stop(LANE_A, STAGE.SYNC),
	stop(LANE_A, run_ship_stage.CONFLICT),
	stop(LANE_B, STAGE.REVIEW),
]

describe('lane_turn_stats.table stop counts', () => {
	it('reads stage stop medians over two dispatched lanes as numeric cells', () => {
		const table = lane_turn_stats.table(STOP_ENTRIES, [], WINDOW)
		const address = { table: TABLE, column: STOPS }

		expect(lane_value_cell.value([table], { ...address, row: STAGE.PREFLIGHT })).toBe(1.5)
		expect(lane_value_cell.value([table], { ...address, row: STAGE.SYNC })).toBe(1)
		expect(lane_value_cell.value([table], { ...address, row: STAGE.REVIEW })).toBe(0.5)
		expect(lane_value_cell.value([table], { ...address, row: STAGE.GATE })).toBe(0)
	})

	it('includes zero-stop lanes without transcripts and excludes other lanes and periods', () => {
		const entries = [
			dispatch(LANE_A),
			dispatch(LANE_B),
			stop(LANE_A, STAGE.REVIEW),
			stop(LANE_A, STAGE.REVIEW),
			stop(LANE_A, STAGE.REVIEW, -2000),
			stop(LANE_C, STAGE.REVIEW),
		]
		const table = lane_turn_stats.table(entries, [call(LANE_A, 1)], WINDOW)

		const address = { table: TABLE, column: STOPS, row: STAGE.REVIEW }

		expect(lane_value_cell.value([table], address)).toBe(1)
	})

	it('prints not measured for stops when no lane was dispatched in the period', () => {
		const table = lane_turn_stats.table([stop(LANE_A, STAGE.REVIEW)], [], WINDOW)

		expect(table).toContain(`| ${STAGE.REVIEW} | not measured | not measured | 0 |`)
	})
})
