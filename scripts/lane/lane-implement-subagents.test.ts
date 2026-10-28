import { describe, expect, it } from 'vitest'
import { lane_implement_subagents, type ImplementLane } from './lane-implement-subagents'
import type { ToolCall } from './lane-transcript-calls'

// joshuafolkken/kit#5297: `lane:stats` prints the implement's subagent time by the agent dispatched,
// over the lanes that dispatched it, a backgrounded call counted at no time.

const MINUTE_MS = 60_000
const INVESTIGATOR = 'subagent: investigator'
const REVIEWER = 'subagent: reviewer'

function agent(start: number, type: string, fields: Partial<ToolCall> = {}): ToolCall {
	return {
		session_id: 'session-1',
		lane: 'lane-1',
		started_ms: start * MINUTE_MS,
		duration_ms: 2 * MINUTE_MS,
		tool: 'Agent',
		background: false,
		command: undefined,
		subagent: { type, model: undefined },
		output: '',
		...fields,
	}
}

function lane(calls: ReadonlyArray<ToolCall>): ImplementLane {
	return { calls, paused: [] }
}

describe('lane_implement_subagents.rows', () => {
	it('prints one row per agent type, by name, with its lanes, median and max', () => {
		const lanes = [
			lane([agent(0, 'reviewer'), agent(5, 'investigator'), agent(9, 'reviewer')]),
			lane([agent(0, 'reviewer', { duration_ms: 8 * MINUTE_MS })]),
			lane([]),
		]

		expect(lane_implement_subagents.rows(lanes)).toStrictEqual([
			[INVESTIGATOR, '1', '2.0', '2.0', '0'],
			[REVIEWER, '2', '6.0', '8.0', '0'],
		])
	})

	it('takes the time the lane stood paused out of a subagent call', () => {
		const paused = [{ from_ms: MINUTE_MS, to_ms: 2 * MINUTE_MS }]
		const rows = lane_implement_subagents.rows([{ calls: [agent(0, 'investigator')], paused }])

		expect(rows).toStrictEqual([[INVESTIGATOR, '1', '1.0', '1.0', '0']])
	})

	it('prints no row for a call that dispatched no agent', () => {
		const bash = agent(0, 'x', { tool: 'Bash', subagent: undefined })

		expect(lane_implement_subagents.rows([lane([bash])])).toStrictEqual([])
	})
})

describe('lane_implement_subagents.rows — backgrounded calls', () => {
	const backgrounded = agent(0, 'reviewer', { background: true, duration_ms: undefined })

	it('counts a backgrounded call on its row, leaving a lane that timed none out of the median', () => {
		const lanes = [
			lane([agent(0, 'reviewer', { duration_ms: 6 * MINUTE_MS }), backgrounded]),
			lane([backgrounded]),
		]

		expect(lane_implement_subagents.rows(lanes)).toStrictEqual([[REVIEWER, '1', '6.0', '6.0', '2']])
	})

	it('measures no lane for a type whose every call was backgrounded', () => {
		const not_measured = 'not measured'

		expect(lane_implement_subagents.rows([lane([backgrounded])])).toStrictEqual([
			[REVIEWER, '0', not_measured, not_measured, '1'],
		])
	})
})
