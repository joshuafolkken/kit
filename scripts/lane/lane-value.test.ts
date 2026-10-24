import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import type { ToolCall } from './lane-transcript-calls'
import { lane_value, type LaneRecords } from './lane-value'

// joshuafolkken/kit#4630: each follow-up measurement a lane read by hand from the transcripts or the
// ledger is one number, cut at the `--since` instant, and a period with no sample has no value.

const NOW = Date.parse('2026-10-23T12:00:00.000Z')
const SINCE = Date.parse('2026-10-23T06:00:00.000Z')
const WINDOW = { since_ms: SINCE, until_ms: NOW }
const INSIDE = NOW - 60_000
const BEFORE = SINCE - 60_000
const SECOND = 1000
const MINUTE = 60_000
const LINT = 'pnpm josh lint:related'
const LINT_RELATED = 'lint:related'
const LINT_UNMOVED = 'lint-unmoved'
const METRICS_STOPS = 'metrics-stops'
const LINT_CORE_WAIT = 'lint-core-wait'
const UNMOVED =
	'lint:related: nothing moved since its last green run on this checkout — linting nothing.'
const SHIP = 'pnpm josh ship --detach --review "Title #1"'
const METRICS_STOP = '✗ josh metrics --totals-only --rerecord — exit code 1\nmetrics grew'

function call(overrides: Partial<ToolCall>): ToolCall {
	return {
		session_id: 'one',
		lane: 'lane-1',
		started_ms: INSIDE,
		duration_ms: SECOND,
		tool: 'Bash',
		background: false,
		command: undefined,
		output: '',
		...overrides,
	}
}

function core_wait(command: string, waited_ms: number, at = INSIDE): LedgerEntry {
	return { kind: 'core-wait', at: new Date(at).toISOString(), command, waited_ms, issue: 1 }
}

function value(name: string, records: Partial<LaneRecords>): number | undefined {
	return lane_value.value(name, { entries: [], calls: [], ...records }, WINDOW)
}

describe('lane_value.value — transcript medians', () => {
	it('lint-unmoved: the median of solo lint:related runs that found nothing moved', () => {
		const calls = [
			call({ command: LINT, output: UNMOVED, duration_ms: SECOND }),
			call({ command: LINT, output: UNMOVED, duration_ms: 3 * SECOND }),
			call({ command: LINT, output: 'lint:related: 2 files', duration_ms: 40 * SECOND }),
			call({ command: `${LINT} && pnpm josh test:related`, output: UNMOVED }),
			call({ command: LINT, output: UNMOVED, started_ms: BEFORE, duration_ms: 90 * SECOND }),
		]

		expect(value(LINT_UNMOVED, { calls })).toBe(2)
	})

	it('edit: the median of the Edit calls alone', () => {
		const calls = [
			call({ tool: 'Edit', duration_ms: SECOND }),
			call({ tool: 'Edit', duration_ms: 2 * SECOND }),
			call({ tool: 'Edit', duration_ms: 4 * SECOND }),
			call({ tool: 'Bash', duration_ms: 50 * SECOND }),
		]

		expect(value('edit', { calls })).toBe(2)
	})

	it.each([LINT_UNMOVED, 'edit'])('%s has no value without a sample', (name) => {
		expect(value(name, { calls: [call({ command: 'git status' })] })).toBeUndefined()
	})
})

// Three sessions in two lanes: lane-1's child and its ship reviewer, and lane-2's child.
const LANE_SESSIONS = [
	call({ session_id: 'one' }),
	call({ session_id: 'one-reviewer' }),
	call({ session_id: 'two', lane: 'lane-2' }),
]

describe('lane_value.value — per lane, not per session', () => {
	const sessions = LANE_SESSIONS

	it('metrics-stops: the ship calls the metrics totals stopped, per lane', () => {
		const calls = [
			...sessions,
			call({ command: SHIP, output: `=== pre-detach checks ===\n${METRICS_STOP}` }),
			call({ command: SHIP, output: '✗ josh metrics --totals-only — exit code 1' }),
			call({ command: SHIP, output: '✗ josh cspell:dot — exit code 1' }),
			call({ command: 'cat log', output: METRICS_STOP }),
		]

		expect(value(METRICS_STOPS, { calls })).toBe(1)
	})

	it('lint-core-wait: the minutes a lane lint:related waited in the period, per lane', () => {
		const at = new Date(INSIDE).toISOString()
		const outside_a_lane: LedgerEntry = {
			kind: 'core-wait',
			at,
			command: LINT_RELATED,
			waited_ms: 10 * MINUTE,
		}
		const entries = [
			core_wait(LINT_RELATED, 2 * MINUTE),
			core_wait(LINT_RELATED, MINUTE),
			core_wait('test:related', 10 * MINUTE),
			core_wait(LINT_RELATED, 10 * MINUTE, BEFORE),
			outside_a_lane,
		]

		expect(value(LINT_CORE_WAIT, { entries, calls: sessions })).toBe(1.5)
	})

	it.each([METRICS_STOPS, LINT_CORE_WAIT])('%s has no value when no lane ran', (name) => {
		expect(value(name, { entries: [core_wait(LINT_RELATED, MINUTE)] })).toBeUndefined()
	})
})

describe('lane_value.is_metric', () => {
	it('knows the four metrics and nothing else', () => {
		expect(lane_value.NAMES).toStrictEqual([LINT_UNMOVED, METRICS_STOPS, LINT_CORE_WAIT, 'edit'])
		expect(lane_value.is_metric('edit')).toBe(true)
		expect(lane_value.is_metric('toString')).toBe(false)
		expect(value('toString', {})).toBeUndefined()
	})
})
