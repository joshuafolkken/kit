import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_record_command_stats } from './lane-record-command-stats'
import { lane_stats } from './lane-stats'
import type { ToolCall } from './lane-transcript-calls'
import { lane_value_cell } from './lane-value-cell'

// joshuafolkken/kit#7595: `lane:stats` times one solo call of each recording josh command a lane runs,
// leaves chained and backgrounded calls out, and sets the ledger's `run:entry › …` step medians beside
// the `run:entry` row.

const NOW = Date.parse('2026-11-15T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const SECOND = 1000
const TABLE = 'recording command'
const LANE_PLAN = 'pnpm josh lane:plan 7595 a.ts'
const NOT_MEASURED = 'not measured'
const MEDIAN = 'median (s)'
const TOTAL = 'total (min)'
const ENTRY_LANE_PLAN = 'run:entry › lane:plan'

function call(command: string, seconds: number | undefined): ToolCall {
	return {
		session_id: 'one',
		lane: 'lane-1',
		started_ms: NOW - MS_PER_MINUTE,
		duration_ms: seconds === undefined ? undefined : seconds * SECOND,
		tool: 'Bash',
		background: seconds === undefined,
		command,
		subagent: undefined,
		output: '',
	}
}

function lap(step: string, seconds: number): LedgerEntry {
	return {
		kind: 'ship-lap',
		at: new Date(NOW - MS_PER_MINUTE).toISOString(),
		issue: 7595,
		stage: 'entry',
		step,
		elapsed_ms: seconds * SECOND,
	}
}

function cell(
	entries: ReadonlyArray<LedgerEntry>,
	calls: ReadonlyArray<ToolCall>,
	address: { row: string; column: string },
): string | undefined {
	const table = lane_record_command_stats.table(entries, calls, WINDOW)
	const header = table.split('\n', 1)[0]?.slice(2, -2).split(' | ') ?? []
	const line = table.split('\n').find((text) => text.startsWith(`| ${address.row} |`))

	return line?.slice(2, -2).split(' | ')[header.indexOf(address.column)]
}

describe('lane_record_command_stats.table — solo calls', () => {
	const calls = [
		call(LANE_PLAN, 20),
		call(`cd lane && ${LANE_PLAN}`, 30),
		call(`${LANE_PLAN} && pnpm josh run:cut 7595`, 90),
		call(LANE_PLAN, undefined),
	]

	it('counts a solo call and leaves a chained or backgrounded one out', () => {
		expect(cell([], calls, { row: 'lane:plan', column: 'solo runs' })).toBe('2')
		expect(cell([], calls, { row: 'lane:plan', column: MEDIAN })).toBe('25.0')
		expect(cell([], calls, { row: 'lane:plan', column: 'max (s)' })).toBe('30.0')
		expect(cell([], calls, { row: 'lane:plan', column: TOTAL })).toBe('0.8')
	})

	it('reads not measured for a command with no solo call', () => {
		expect(cell([], calls, { row: 'run:cut', column: 'solo runs' })).toBe('0')
		expect(cell([], calls, { row: 'run:cut', column: MEDIAN })).toBe(NOT_MEASURED)
		expect(cell([], calls, { row: 'cost', column: TOTAL })).toBe(NOT_MEASURED)
	})

	it('names every recording command in one row each', () => {
		const rows = lane_record_command_stats.table([], [], WINDOW).split('\n').slice(2)

		expect(rows).toHaveLength(lane_record_command_stats.RECORDING_COMMANDS.length)
	})
})

describe('lane_record_command_stats.table — run:entry ledger steps', () => {
	const entries = [
		lap(ENTRY_LANE_PLAN, 10),
		lap(ENTRY_LANE_PLAN, 20),
		lap('run:entry › run:hold', 5),
		lap('josh gate', 300),
	]
	const column = 'ledger steps, median sum (s)'

	it('sums the median of each run:entry step on the run:entry row only', () => {
		expect(cell(entries, [], { row: 'run:entry', column })).toBe('20.0')
		expect(cell(entries, [], { row: 'cost', column })).toBe('—')
	})

	it('leaves out a child lap nested inside a run:entry step', () => {
		const nested = [...entries, lap('run:entry › run:hold › startup', 4)]

		expect(cell(nested, [], { row: 'run:entry', column })).toBe('20.0')
	})

	it('reads not measured when the ledger holds no run:entry step', () => {
		expect(cell([], [], { row: 'run:entry', column })).toBe(NOT_MEASURED)
	})

	it('is read by lane:value cell', () => {
		const table = lane_record_command_stats.table(entries, [], WINDOW)
		const address = { table: TABLE, row: 'run:entry', column }

		expect(lane_value_cell.value([table], address)).toBe(20)
	})
})
