import { describe, expect, it } from 'vitest'
import { lane_implement_stats } from './lane-implement-stats'
import type { PausedSpans } from './lane-paused-spans'
import type { ToolCall } from './lane-transcript-calls'

// joshuafolkken/kit#4887: the implement stage is broken down by what each call's span went on, from the
// lane's transcript, up to its first `josh ship`.

const MINUTE_MS = 60_000
const LANE = '/home/.claude/projects/-kit-lanes-4887'
const SESSION = 'session-1'
const WINDOW = { since_ms: 0, until_ms: 1000 * MINUTE_MS }
const CHECK_RELATED = 'pnpm josh check:related'
const SHIP = 'pnpm josh ship'
const LINT_RELATED = 'pnpm josh lint:related scripts/lane'
const LANE_ISSUE = 4887
const NO_PAUSE: PausedSpans = new Map()

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
		subagent: undefined,
		output: '',
		...fields,
	}
}

function minutes_of(
	calls: ReadonlyArray<ToolCall>,
	paused: PausedSpans = NO_PAUSE,
): Record<string, number> {
	const [totals] = lane_implement_stats.lane_totals_in(calls, WINDOW, paused)

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
		expect(
			lane_implement_stats.lane_totals_in(LANE_CALLS.slice(0, -2), WINDOW, NO_PAUSE),
		).toStrictEqual([])
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

// joshuafolkken/kit#5168: a `lane:pause` left seven hours on the clock of the one call in flight.
describe('lane_implement_stats.lane_totals_in — a paused lane', () => {
	it('takes the time the lane stood paused out of the call in flight across it', () => {
		const stopped = [
			call(0, { tool: 'Read' }),
			call(2, { command: CHECK_RELATED, duration_ms: 400 * MINUTE_MS }),
			call(403, { command: SHIP }),
		]
		const paused = new Map([[LANE_ISSUE, [{ from_ms: 3 * MINUTE_MS, to_ms: 399 * MINUTE_MS }]]])

		expect(minutes_of(stopped, paused)['check']).toBe(5)
	})

	it("leaves another lane's paused time in this lane's calls", () => {
		const stopped = [
			call(0, { command: CHECK_RELATED, duration_ms: 10 * MINUTE_MS }),
			call(11, { command: SHIP }),
		]
		const paused = new Map([[LANE_ISSUE + 1, [{ from_ms: 0, to_ms: 10 * MINUTE_MS }]]])

		expect(minutes_of(stopped, paused)['check']).toBe(10)
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
		const table = lane_implement_stats.table([...LANE_CALLS, ...other_lane], WINDOW, NO_PAUSE)

		expect(table).toContain(
			'| implement sub-stage | lanes | median (min) | max (min) | backgrounded |',
		)
		expect(table.split('\n')).toHaveLength(lane_implement_stats.SUB_STAGES.length + 2)
		expect(table).toMatch(/^\| review-fix \| 2 \| 4(?:\.0)? \| \S+ \| {2}\|$/mu)
	})

	// joshuafolkken/kit#5297: which delegation took the implement's subagent time was unreadable.
	it('adds a row per subagent type after the sub-stages, over the lanes that dispatched it', () => {
		const reviewer = { type: 'reviewer', model: 'opus' }
		const calls = [
			call(0, { tool: 'Agent', subagent: reviewer, duration_ms: 4 * MINUTE_MS }),
			call(5, { tool: 'Agent', subagent: reviewer, background: true, duration_ms: undefined }),
			call(6, { command: SHIP }),
		]
		const lines = lane_implement_stats.table(calls, WINDOW, NO_PAUSE).split('\n')

		expect(lines).toHaveLength(lane_implement_stats.SUB_STAGES.length + 3)
		expect(lines.at(-1)).toMatch(/^\| subagent: reviewer \| 1 \| 4(?:\.0)? \| 4(?:\.0)? \| 1 \|$/u)
	})
})

// A lane whose first timed `lint:related` runs `first_minutes`, after an untimed backgrounded one and a
// foreground one its session ended before.
function lint_lane(lane: string, first_minutes: number): Array<ToolCall> {
	return [
		call(0, { command: LINT_RELATED, background: true, duration_ms: undefined, lane }),
		call(0, { command: LINT_RELATED, duration_ms: undefined, lane }),
		call(1, { command: LINT_RELATED, duration_ms: first_minutes * MINUTE_MS, lane }),
		call(20, { command: LINT_RELATED, lane }),
		call(30, { command: SHIP, lane }),
	]
}

// joshuafolkken/kit#5714: a lane's first `lint:related` ran far longer than its later ones (#5657).
describe('lane_implement_stats.table — the lane first lint:related row', () => {
	it("prints each lane's first timed lint:related, not its later runs, over the lanes that ran one", () => {
		const calls = [
			...lint_lane(LANE, 2),
			...lint_lane(`${LANE}-cold`, 8),
			call(0, { tool: 'Edit', lane: `${LANE}-none` }),
			call(2, { command: SHIP, lane: `${LANE}-none` }),
		]
		const table = lane_implement_stats.table(calls, WINDOW, NO_PAUSE)

		expect(table).toMatch(/^\| lane first lint:related \| 2 \| 5(?:\.0)? \| 8(?:\.0)? \| {2}\|$/mu)
	})

	// joshuafolkken/kit#5785: a chained call's duration holds test:related and cspell:dot too.
	it('counts a solo lint:related, not an earlier call that chained it with other checks', () => {
		const calls = [
			call(0, {
				command: `${LINT_RELATED} && pnpm josh test:related && pnpm josh cspell:dot`,
				duration_ms: 9 * MINUTE_MS,
			}),
			call(10, { command: LINT_RELATED, duration_ms: 3 * MINUTE_MS }),
			call(20, { command: SHIP }),
		]
		const table = lane_implement_stats.table(calls, WINDOW, NO_PAUSE)

		expect(table).toMatch(/^\| lane first lint:related \| 1 \| 3(?:\.0)? \| 3(?:\.0)? \| {2}\|$/mu)
	})

	it('prints no row when no lane ran lint:related', () => {
		expect(lane_implement_stats.table(LANE_CALLS, WINDOW, NO_PAUSE)).not.toContain('lint:related')
	})
})
