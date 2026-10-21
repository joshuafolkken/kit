import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { lane_stats } from './lane-stats'
import type { ToolCall } from './lane-transcript-calls'
import { lane_transcript_stats } from './lane-transcript-stats'

// joshuafolkken/kit#4418: `lane:stats` reports the transcript-side lane metrics with fixed definitions —
// a chained verification call is counted apart from a solo one and kept out of the per-command
// medians, only a foreground call is timed, and the period is cut at each call's own timestamp.

const NOW = Date.parse('2026-10-21T12:00:00.000Z')
const MS_PER_HOUR = 3_600_000
const HALF_DAY = 0.5
const WINDOW = lane_stats.window_of(1, NOW)
const SECOND = 1000
const MINUTE = 60_000
const LINT = 'pnpm josh lint:related'
const GATE = 'pnpm josh gate'
const SESSIONS = 'lane sessions'
const SOLO = 'verification calls, solo'
const CHAINED = 'verification calls, chained'
const WAITED = 'waited for the core budget'
const TIME_MEDIAN = 'tool time per session, median (min)'
const TEST_MEDIAN = 'test:related median, solo (s)'
const NOT_MEASURED = 'not measured'
const scratch = mkdtempSync(path.join(tmpdir(), 'lane-transcript-stats-test-'))

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

function call(overrides: Partial<ToolCall>): ToolCall {
	return {
		session_id: 'one',
		started_ms: NOW - MS_PER_HOUR,
		duration_ms: SECOND,
		background: false,
		command: undefined,
		output: '',
		...overrides,
	}
}

// The value cell of the table's row for `metric`.
function value_of(table: string, metric: string): string | undefined {
	const line = table.split('\n').find((text) => text.startsWith(`| ${metric} |`))

	return line?.split(' | ', 2)[1]?.replace(' |', '')
}

describe('lane_transcript_stats.table — verification calls', () => {
	const calls = [
		call({ command: LINT, duration_ms: 4 * SECOND }),
		call({ command: `cd lane && ${LINT}`, duration_ms: 8 * SECOND }),
		call({ command: `${LINT} && pnpm josh test:related`, duration_ms: 56 * SECOND }),
		call({ command: GATE, background: true, duration_ms: undefined }),
		call({ command: 'pnpm josh test:related', output: '⏳ test waits for the core budget — x' }),
		call({ command: 'git status' }),
	]
	const table = lane_transcript_stats.table(calls, WINDOW)

	it('counts a chained call apart from the solo ones', () => {
		expect(value_of(table, SOLO)).toBe('4')
		expect(value_of(table, CHAINED)).toBe('1')
	})

	it('takes the per-command medians over solo foreground calls only', () => {
		expect(value_of(table, 'lint:related median, solo (s)')).toBe('6.0')
		expect(value_of(table, TEST_MEDIAN)).toBe('1.0')
	})

	it('reports the share of verification calls that waited for the core budget', () => {
		expect(value_of(table, WAITED)).toBe('1 of 5 (20.0%)')
	})

	it('counts commands joined by a bare separator as chained', () => {
		const joined = call({ command: `${LINT}; pnpm josh test:related&&${GATE}` })
		const joined_table = lane_transcript_stats.table([joined], WINDOW)

		expect(value_of(joined_table, CHAINED)).toBe('1')
		expect(value_of(joined_table, TEST_MEDIAN)).toBe(NOT_MEASURED)
	})
})

describe('lane_transcript_stats.table — mentioned commands', () => {
	it('leaves out a command a heredoc body or a quoted string only mentions', () => {
		const mentions = [
			call({ command: `cat > /tmp/body.md <<'EOF'\n${LINT}\nEOF\n${GATE}` }),
			call({ command: `gh issue comment 1 --body "run ${LINT} first"` }),
			call({ command: 'echo pnpm josh lint:related' }),
		]
		const mention_table = lane_transcript_stats.table(mentions, WINDOW)

		expect(value_of(mention_table, SOLO)).toBe('1')
		expect(value_of(mention_table, CHAINED)).toBe('0')
	})
})

describe('lane_transcript_stats.table — tool time', () => {
	it('sums each session’s foreground calls and leaves a backgrounded one out', () => {
		const calls = [
			call({ duration_ms: MINUTE }),
			call({ duration_ms: undefined, background: true }),
			call({ session_id: 'two', duration_ms: 3 * MINUTE }),
		]
		const table = lane_transcript_stats.table(calls, WINDOW)

		expect(value_of(table, SESSIONS)).toBe('2')
		expect(value_of(table, TIME_MEDIAN)).toBe('2.0')
		expect(value_of(table, 'tool time per session, mean (min)')).toBe('2.0')
	})

	it('cuts a fractional period at each call’s own timestamp', () => {
		const half_day = lane_stats.window_of(HALF_DAY, NOW)
		const calls = [
			call({ command: GATE }),
			call({ session_id: 'old', command: GATE, started_ms: NOW - 13 * MS_PER_HOUR }),
		]
		const table = lane_transcript_stats.table(calls, half_day)

		expect(value_of(table, SESSIONS)).toBe('1')
		expect(value_of(table, SOLO)).toBe('1')
	})

	it('names an empty period as not measured rather than zero', () => {
		const table = lane_transcript_stats.table([], WINDOW)

		expect(value_of(table, TIME_MEDIAN)).toBe(NOT_MEASURED)
		expect(value_of(table, WAITED)).toBe(NOT_MEASURED)
	})
})

function transcript_line(type: string, block: Record<string, unknown>): string {
	return JSON.stringify({
		type,
		timestamp: new Date().toISOString(),
		message: { content: [block] },
	})
}

describe('lane_transcript_stats.read_calls', () => {
	it('reads the calls of the session transcripts under the given directories', () => {
		const lines = [
			transcript_line('assistant', { type: 'tool_use', id: 'x', input: { command: GATE } }),
			transcript_line('user', { type: 'tool_result', tool_use_id: 'x', content: 'green' }),
		]

		writeFileSync(path.join(scratch, 'session-1.jsonl'), lines.join('\n'))

		const calls = lane_transcript_stats.read_calls([scratch], lane_stats.window_of(1, Date.now()))

		expect(calls).toHaveLength(1)
		expect(calls[0]).toMatchObject({ session_id: 'session-1', command: GATE, output: 'green' })
	})
})
