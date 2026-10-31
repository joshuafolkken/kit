import { describe, expect, it, vi } from 'vitest'
import type { Breakdown } from './lane-breakdown'
import { lane_breakdown_implement } from './lane-breakdown-implement'
import type { ToolCall } from './lane-transcript-calls'
import { lane_transcript_stats } from './lane-transcript-stats'

// joshuafolkken/kit#4995: #4970's implementation was one span, so which command took its
// time was unknown. Its tool calls split it by kind; what no call spent is the edits and the thinking.

const MINUTE_MS = 60_000
const IMPLEMENT_FROM = 10 * MINUTE_MS
const IMPLEMENT_TO = 61 * MINUTE_MS
const REMAINDER = 'editing & thinking'
const GATE = 'pnpm josh gate'
const GIT_STATUS = 'git status'
const OTHER_BASH = 'other bash'
const GENERAL_PURPOSE = 'subagent: general-purpose'
const REVIEWER = 'subagent: reviewer'

const BREAKDOWN: Breakdown = {
	stages: [{ name: 'implement', ms: IMPLEMENT_TO - IMPLEMENT_FROM }],
	excluded_ms: 0,
	slept_ms: 0,
	yield_ms: 0,
	waits: [],
	implement: [{ from_ms: IMPLEMENT_FROM, to_ms: IMPLEMENT_TO }],
	pre_detach: [],
	ship: [],
}

interface CallShape {
	minute: number
	minutes: number | undefined
	tool: string
	command?: string
	background?: boolean
	agent?: string
}

const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task'])

function call(shape: CallShape): ToolCall {
	const is_subagent = SUBAGENT_TOOLS.has(shape.tool)

	return {
		session_id: 's',
		lane: '4970',
		started_ms: shape.minute * MINUTE_MS,
		duration_ms: shape.minutes === undefined ? undefined : shape.minutes * MINUTE_MS,
		tool: shape.tool,
		background: shape.background ?? false,
		command: shape.command,
		subagent: is_subagent
			? { type: shape.agent ?? 'general-purpose', model: undefined }
			: undefined,
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

// joshuafolkken/kit#5293: run:review waits need their own kind so they do not hide in other bash.
describe('lane_breakdown_implement.of — run:review and ship', () => {
	it('counts run:review and ship / ship:wait apart from other bash', () => {
		const calls = [
			bash(11, 10, 'pnpm josh run:review --pinned 2>&1'),
			bash(25, 2, 'pnpm josh run:review --join'),
			bash(30, 5, 'pnpm josh ship --detach --review "t #1"'),
			bash(40, 4, 'pnpm josh ship:wait 1'),
			bash(50, 1, GIT_STATUS),
		]

		expect(kinds_of(calls)).toStrictEqual([
			[REMAINDER, 29],
			['run:review', 12],
			['ship / ship:wait', 9],
			[OTHER_BASH, 1],
		])
	})
})

describe('lane_breakdown_implement.of — kinds', () => {
	it('sums the calls by kind, longest first, the rest as editing & thinking', () => {
		const calls = [
			bash(11, 4, 'pnpm josh main:merge'),
			bash(20, 6, 'pnpm josh check:related'),
			bash(30, 3, 'pnpm josh test:related a.test.ts'),
			bash(35, 2, 'pnpm josh lint:related'),
			bash(40, 1, GIT_STATUS),
			call({ minute: 42, minutes: 10, tool: 'Agent' }),
			call({ minute: 55, minutes: 2, tool: 'Read' }),
			call({ minute: 58, minutes: 1, tool: 'Edit' }),
		]

		expect(kinds_of(calls)).toStrictEqual([
			[REMAINDER, 23],
			[GENERAL_PURPOSE, 10],
			['check:related', 6],
			['main:merge', 4],
			['test', 3],
			['lint / cspell', 2],
			['read', 2],
			[OTHER_BASH, 1],
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
			[GENERAL_PURPOSE, 16],
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
		expect(detail.untimed).toStrictEqual(new Map())
	})

	it('names a backgrounded subagent call under its type at no time, and counts it', () => {
		const shape = { minute: 20, minutes: undefined, tool: 'Agent', background: true }
		const detail = lane_breakdown_implement.of([call({ ...shape, agent: 'reviewer' })], BREAKDOWN)

		expect(detail.kinds).toStrictEqual([
			{ name: REMAINDER, ms: 51 * MINUTE_MS },
			{ name: REVIEWER, ms: 0 },
		])
		expect(detail.untimed).toStrictEqual(new Map([[REVIEWER, 1]]))
	})
})

// joshuafolkken/kit#5297: one `subagent` total hid which delegation took the time.
describe('lane_breakdown_implement.of — subagent types', () => {
	it('splits the subagent time by the agent type each call dispatched', () => {
		const calls = [
			call({ minute: 11, minutes: 3, tool: 'Agent', agent: 'investigator' }),
			call({ minute: 20, minutes: 6, tool: 'Agent', agent: 'reviewer' }),
			call({ minute: 30, minutes: 2, tool: 'Task', agent: 'reviewer-verification' }),
			call({ minute: 40, minutes: 1, tool: 'Agent', agent: 'reviewer' }),
		]

		expect(kinds_of(calls)).toStrictEqual([
			[REMAINDER, 39],
			[REVIEWER, 7],
			['subagent: investigator', 3],
			['subagent: reviewer-verification', 2],
		])
	})
})

// joshuafolkken/kit#5294: the ship's laps run past the implementation, so the calls read reach its end.
describe('lane_breakdown_implement.read — window', () => {
	it('reads the calls up to the end of the last ship stage', () => {
		const spy = vi.spyOn(lane_transcript_stats, 'read_calls').mockReturnValue([])
		const ship = [{ stage: 'ship report', from_ms: 70 * MINUTE_MS, to_ms: 80 * MINUTE_MS }]

		lane_breakdown_implement.read(4970, { ...BREAKDOWN, ship })

		expect(spy.mock.calls[0]?.[1]).toStrictEqual({
			since_ms: IMPLEMENT_FROM,
			until_ms: 80 * MINUTE_MS,
		})
		spy.mockRestore()
	})
})
