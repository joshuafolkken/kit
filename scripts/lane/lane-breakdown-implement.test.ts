import { describe, expect, it } from 'vitest'
import type { Breakdown } from './lane-breakdown'
import { lane_breakdown_implement } from './lane-breakdown-implement'
import type { ToolCall } from './lane-transcript-calls'

// joshuafolkken/kit#4995: #4970's 51-minute implementation was one span, so which command took its
// time was unknown. Its tool calls split it by kind; what no call spent is the edits and the thinking.

const MINUTE_MS = 60_000
const IMPLEMENT_FROM = 10 * MINUTE_MS
const IMPLEMENT_TO = 61 * MINUTE_MS
const REMAINDER = 'editing & thinking'
const GATE = 'pnpm josh gate'

const BREAKDOWN: Breakdown = {
	stages: [{ name: 'implement', ms: IMPLEMENT_TO - IMPLEMENT_FROM }],
	excluded_ms: 0,
	waits: [],
	implement: [{ from_ms: IMPLEMENT_FROM, to_ms: IMPLEMENT_TO }],
}

interface CallShape {
	minute: number
	minutes: number | undefined
	tool: string
	command?: string
	background?: boolean
}

function call(shape: CallShape): ToolCall {
	return {
		session_id: 's',
		lane: '4970',
		started_ms: shape.minute * MINUTE_MS,
		duration_ms: shape.minutes === undefined ? undefined : shape.minutes * MINUTE_MS,
		tool: shape.tool,
		background: shape.background ?? false,
		command: shape.command,
		output: '',
	}
}

function bash(minute: number, minutes: number, command: string): ToolCall {
	return call({ minute, minutes, tool: 'Bash', command })
}

function kinds_of(calls: ReadonlyArray<ToolCall>): Array<readonly [string, number]> {
	const detail = lane_breakdown_implement.of(calls, BREAKDOWN)

	return detail.kinds.map((kind) => [kind.name, kind.ms / MINUTE_MS] as const)
}

describe('lane_breakdown_implement.of — kinds', () => {
	it('sums the calls by kind, longest first, the rest as editing & thinking', () => {
		const calls = [
			bash(11, 4, 'pnpm josh main:merge'),
			bash(20, 6, 'pnpm josh check:related'),
			bash(30, 3, 'pnpm josh test:related a.test.ts'),
			bash(35, 2, 'pnpm josh lint:related'),
			bash(40, 1, 'git status'),
			call({ minute: 42, minutes: 10, tool: 'Agent' }),
			call({ minute: 55, minutes: 2, tool: 'Read' }),
			call({ minute: 58, minutes: 1, tool: 'Edit' }),
		]

		expect(kinds_of(calls)).toStrictEqual([
			[REMAINDER, 23],
			['subagent', 10],
			['check:related', 6],
			['main:merge', 4],
			['test', 3],
			['lint / cspell', 2],
			['read', 2],
			['other bash', 1],
		])
	})

	it('counts no call made outside the implementation', () => {
		const calls = [bash(5, 3, GATE), bash(70, 3, GATE)]

		expect(kinds_of(calls)).toStrictEqual([[REMAINDER, 51]])
	})

	it('cuts a call at the end of the implementation', () => {
		expect(kinds_of([bash(60, 5, GATE)])).toStrictEqual([
			[REMAINDER, 50],
			['gate', 1],
		])
	})
})

// The review of joshuafolkken/kit#4995: summing the calls' durations counted parallel calls, and a call
// across a wait, twice, and the remainder clamped to zero hid it.
describe('lane_breakdown_implement.of — overlapping time', () => {
	it('leaves in editing & thinking only the time no parallel call covered', () => {
		const calls = [
			call({ minute: 20, minutes: 8, tool: 'Agent' }),
			call({ minute: 20, minutes: 8, tool: 'Agent' }),
		]

		expect(kinds_of(calls)).toStrictEqual([
			[REMAINDER, 43],
			['subagent', 16],
		])
	})

	it('leaves a wait out of editing & thinking, a call across it included', () => {
		const wait = { from_ms: 30 * MINUTE_MS, to_ms: 40 * MINUTE_MS }
		const waited = { ...BREAKDOWN, excluded_ms: 10 * MINUTE_MS, waits: [wait] }
		const detail = lane_breakdown_implement.of([bash(25, 10, GATE)], waited)

		expect(detail.kinds).toStrictEqual([
			{ name: REMAINDER, ms: 36 * MINUTE_MS },
			{ name: 'gate', ms: 10 * MINUTE_MS },
		])
	})
})

describe('lane_breakdown_implement.of — backgrounded calls', () => {
	it('counts a backgrounded call, its wait left in editing & thinking', () => {
		const backgrounded = call({
			minute: 20,
			minutes: undefined,
			tool: 'Bash',
			command: GATE,
			background: true,
		})
		const detail = lane_breakdown_implement.of([backgrounded], BREAKDOWN)

		expect(detail.background).toBe(1)
		expect(detail.kinds).toStrictEqual([{ name: REMAINDER, ms: 51 * MINUTE_MS }])
	})
})
