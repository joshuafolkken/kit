import { describe, expect, it } from 'vitest'
import { lane_implement_stats } from './lane-implement-stats'
import type { ToolCall } from './lane-transcript-calls'

// joshuafolkken/kit#4887: the implement stage is broken down by what each call's span went on, from the
// lane's transcript, up to its first `josh ship`.

const MINUTE_MS = 60_000
const LANE = '/home/.claude/projects/-kit-lanes-4887'
const SESSION = 'session-1'
const WINDOW = { since_ms: 0, until_ms: 1000 * MINUTE_MS }
const CHECK_RELATED = 'pnpm josh check:related'
const SHIP = 'pnpm josh ship'

// A call that starts at `start` minutes and runs for one minute.
function call(start: number, fields: Partial<ToolCall>): ToolCall {
	return {
		session_id: SESSION,
		lane: LANE,
		started_ms: start * MINUTE_MS,
		duration_ms: MINUTE_MS,
		tool: 'Bash',
		background: false,
		command: undefined,
		output: '',
		...fields,
	}
}

function minutes_of(calls: ReadonlyArray<ToolCall>): Record<string, number> {
	const [totals] = lane_implement_stats.lane_totals_in(calls, WINDOW)

	return Object.fromEntries(
		[...(totals ?? new Map<string, number>())].map(([stage, ms]) => [stage, ms / MINUTE_MS]),
	)
}

const LANE_CALLS = [
	call(0, { tool: 'Read' }),
	call(2, { command: 'pnpm josh issue:read 4887' }),
	call(4, { tool: 'Edit' }),
	call(6, { tool: 'Grep' }),
	call(8, { command: CHECK_RELATED }),
	call(10, { command: 'pnpm josh run:review' }),
	call(12, { tool: 'Edit' }),
	call(14, { command: 'pnpm josh ship --detach "Title #4887"' }),
	call(16, { tool: 'Edit' }),
]

describe('lane_implement_stats.lane_totals_in — the sub-stages', () => {
	it('puts each span, the turn before the call included, to its sub-stage, up to the ship', () => {
		expect(minutes_of(LANE_CALLS)).toStrictEqual({
			plan: 3,
			read: 2,
			edit: 2,
			check: 2,
			'review-fix': 4,
		})
	})

	it('counts no implement for a lane that never shipped', () => {
		expect(lane_implement_stats.lane_totals_in(LANE_CALLS.slice(0, -2), WINDOW)).toStrictEqual([])
	})

	it("spans a later session's first call by its own duration, not the gap since the last session", () => {
		const resumed = [
			call(0, { tool: 'Edit' }),
			call(30, { tool: 'Edit', session_id: 'session-2' }),
			call(32, { command: SHIP }),
		]

		expect(minutes_of(resumed)['edit']).toBe(2)
	})
})

describe('lane_implement_stats.lane_totals_in — calls made side by side', () => {
	it('spans a call beside a longer one only by what it runs past it, counting no minute twice', () => {
		const parallel = [
			call(0, { command: CHECK_RELATED, duration_ms: 3 * MINUTE_MS }),
			call(0, { tool: 'Read' }),
			call(4, { tool: 'Edit' }),
			call(6, { command: SHIP }),
		]

		expect(minutes_of(parallel)).toStrictEqual({
			plan: 0,
			read: 0,
			edit: 2,
			check: 3,
			'review-fix': 0,
		})
	})
})

describe('lane_implement_stats.table', () => {
	it('prints a row per sub-stage with its median over the lanes', () => {
		const other_lane = LANE_CALLS.map((entry) => ({ ...entry, lane: `${LANE}-other` }))
		const table = lane_implement_stats.table([...LANE_CALLS, ...other_lane], WINDOW)

		expect(table).toContain('| implement sub-stage | lanes | median (min) | max (min) |')
		expect(table.split('\n')).toHaveLength(lane_implement_stats.SUB_STAGES.length + 2)
		expect(table).toMatch(/\| review-fix \| 2 \| 4(?:\.0)? \|/u)
	})
})
