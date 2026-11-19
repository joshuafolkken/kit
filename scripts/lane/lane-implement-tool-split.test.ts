import { describe, expect, it } from 'vitest'
import { lane_implement_tool_split } from './lane-implement-tool-split'
import type { PausedSpans } from './lane-paused-spans'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats } from './lane-stats'
import type { ToolCall } from './lane-transcript-calls'

const MINUTE_MS = 60_000
const LANE = '/home/.claude/projects/-kit-lanes-8093'
const WINDOW = { since_ms: 0, until_ms: 1000 * MINUTE_MS }
const NO_PAUSE: PausedSpans = new Map()
const HEADER_ROWS = 2
const SHIP = 'pnpm josh ship'

function call(start: number, fields: Partial<ToolCall>): ToolCall {
	return {
		session_id: 'session-1',
		lane: LANE,
		started_ms: start * MINUTE_MS,
		duration_ms: MINUTE_MS,
		tool: 'Bash',
		background: false,
		command: undefined,
		subagent: undefined,
		output: '',
		...fields,
	}
}

// One lane through every sub-stage; the read stage's second call runs beside the first in
// another session, so its run overlaps the first one's.
const LANE_CALLS = [
	call(0, { command: 'ls' }),
	call(2, { tool: 'Read' }),
	call(4, { tool: 'Edit' }),
	call(6, { tool: 'Read', duration_ms: 4 * MINUTE_MS }),
	call(7, { tool: 'Grep', duration_ms: 4 * MINUTE_MS, session_id: 'session-2' }),
	call(13, { command: 'pnpm josh lint:related', duration_ms: 2 * MINUTE_MS }),
	call(16, { command: 'pnpm josh review:brief' }),
	call(18, { command: SHIP }),
]

function expected_row(stage: string, model_min: number, tool_min: number): string {
	return lane_stats.to_row([
		stage,
		'1',
		lane_stage_stats.cell(model_min * MINUTE_MS),
		lane_stage_stats.cell(tool_min * MINUTE_MS),
	])
}

function stage_rows(calls: ReadonlyArray<ToolCall>): Array<string> {
	return lane_implement_tool_split.table(calls, WINDOW, NO_PAUSE).split('\n').slice(HEADER_ROWS)
}

describe('lane_implement_tool_split.table', () => {
	it('splits every sub-stage into model turns and tool time', () => {
		expect(stage_rows(LANE_CALLS)).toStrictEqual([
			expected_row('plan', 1, 2),
			expected_row('read', 4, 5),
			expected_row('edit', 1, 1),
			expected_row('check', 0, 2),
			expected_row('review-fix', 1, 1),
		])
	})

	it('counts parallel tool runs once', () => {
		// The two read runs overlap, so their shared stretch counts once.
		expect(stage_rows(LANE_CALLS)[1]).toBe(expected_row('read', 4, 5))
	})

	it('counts a backgrounded call as model turn', () => {
		const calls = [
			call(0, { command: 'ls' }),
			call(2, { command: 'sleep 1', background: true }),
			call(4, { command: SHIP }),
		]

		expect(stage_rows(calls)[0]).toBe(expected_row('plan', 2, 1))
	})

	it('prints the turn split columns', () => {
		expect(lane_implement_tool_split.table(LANE_CALLS, WINDOW, NO_PAUSE)).toContain(
			'| implement turn split | lanes | model turn (min) | tool (min) |',
		)
	})
})
