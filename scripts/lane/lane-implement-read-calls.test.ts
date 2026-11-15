import { describe, expect, it } from 'vitest'
import { lane_implement_read_calls } from './lane-implement-read-calls'
import type { PausedSpans } from './lane-paused-spans'
import type { ToolCall } from './lane-transcript-calls'

// joshuafolkken/kit#7548: the implement `read` table gave the tool time only as a total, so which
// tool or josh command took it was unread and no shortening Issue could pick its target.

const MINUTE_MS = 60_000
const LANE = '/home/.claude/projects/-kit-lanes-7548'
const WINDOW = { since_ms: 0, until_ms: 1000 * MINUTE_MS }
const NO_PAUSE: PausedSpans = new Map()

// A call that starts at `start` minutes and runs for `minutes`.
function call(start: number, fields: Partial<ToolCall>, minutes = 1): ToolCall {
	return {
		session_id: 'session-1',
		lane: LANE,
		started_ms: start * MINUTE_MS,
		duration_ms: minutes * MINUTE_MS,
		tool: 'Bash',
		background: false,
		command: undefined,
		subagent: undefined,
		output: '',
		...fields,
	}
}

const LANE_CALLS = [
	call(0, { tool: 'Grep' }, 1),
	call(2, { tool: 'Edit' }),
	call(4, { tool: 'Read' }),
	call(6, { command: 'cd /repo && grep -n x file.ts' }, 3),
	call(10, { command: 'pnpm josh doc:read fullrun-lane.md' }, 2),
	call(13, { tool: 'Read' }),
	call(15, { tool: 'Bash', command: 'sleep 9', duration_ms: undefined, background: true }),
	call(20, { command: 'pnpm josh ship' }),
]

function rows(calls: ReadonlyArray<ToolCall>): Array<string> {
	return lane_implement_read_calls.table(calls, WINDOW, NO_PAUSE).split('\n').slice(2)
}

describe('lane_implement_read_calls.kind_of', () => {
	it('names a josh run by its subcommands', () => {
		expect(
			lane_implement_read_calls.kind_of(
				call(0, { command: 'pnpm josh lint:related && pnpm josh test:related' }),
			),
		).toBe('josh lint:related+test:related')
	})

	it('names another Bash command by its leading word past a cd', () => {
		expect(
			lane_implement_read_calls.kind_of(call(0, { command: 'cd /repo && sed -n 1,2p a.ts' })),
		).toBe('sed')
	})

	it('names a subagent by its type and any other call by its tool', () => {
		const agent = call(0, { tool: 'Agent', subagent: { type: 'investigator', model: undefined } })

		expect(lane_implement_read_calls.kind_of(agent)).toBe('Agent:investigator')
		expect(lane_implement_read_calls.kind_of(call(0, { tool: 'Read' }))).toBe('Read')
	})
})

describe('lane_implement_read_calls.table', () => {
	it('prints the by-call columns', () => {
		expect(lane_implement_read_calls.table(LANE_CALLS, WINDOW, NO_PAUSE)).toContain(
			'| implement read by call | calls | lanes | median per lane (min) | total (min) |',
		)
	})

	it('orders the read kinds by total tool time and leaves out the plan-stage calls', () => {
		expect(rows(LANE_CALLS).map((row) => row.split('|', 2)[1]?.trim())).toStrictEqual([
			'grep',
			'josh doc:read',
			'Read',
			'sleep',
		])
	})

	it('sums a kind over its calls and counts a backgrounded call no tool time', () => {
		expect(rows(LANE_CALLS)).toContain('| Read | 2 | 1 | 2.0 | 2.0 |')
		expect(rows(LANE_CALLS)).toContain('| sleep | 1 | 1 | 0.0 | 0.0 |')
	})
})
