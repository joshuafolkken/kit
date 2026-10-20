import type { EpicChild } from '#scripts/epic/epic-graph'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import type { BoardPlan } from './run-board-layout'
import { run_board_reason, type ReasonRead } from './run-board-reason'

// joshuafolkken/kit#4279: while `backlogrun #4263 #4262 --only` planned, no queued row said which issue
// the header's `📝 planning` was for.

const REPO = 'joshuafolkken/kit'
const HEAD = 4263
const SECOND = 4262
const PLANNED_AT = '2026-10-20T04:00:00.000Z'
const OPENING_AT = '2026-10-20T04:01:00.000Z'
// joshuafolkken/kit#4288: the row leads with 📝, and its condition column counts the planning.
const PLANNING = '📝'
const NAMED_ORDER = '📋'
const OPENING = '🚪'
const CARRY: RunCarry = {
	invocation: `backlogrun #${String(HEAD)} #${String(SECOND)} --only`,
	started_at: PLANNED_AT,
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}

function setup(pos: number, at: string, text: string): RunEvent {
	return { pos, at, kind: 'setup', text }
}

const PLANNING_EVENTS = [setup(1, PLANNED_AT, run_event_setup.STAGE.PLANNING)]

function child(number: number): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels: [RUN_LANE_LABEL], blocked_by: [] }
}

function plan_of(children: Array<EpicChild>): BoardPlan {
	return {
		waves: { waves: [children], unreached: [] },
		tracked: new Map(),
		context: {
			repo: REPO,
			titles: new Map(),
			open_numbers: new Set(children.map((item) => item.number)),
		},
		labels: new Map(),
	}
}

// Each row's icon and the time its reason counts from, the plan's wave order second-first.
function rows(extra: Partial<ReasonRead> = {}): Array<Array<string | number | undefined>> {
	const children = [child(SECOND), child(HEAD)]
	const reason_of = run_board_reason.reader({
		plan: plan_of(children),
		statuses: new Map(),
		events: PLANNING_EVENTS,
		free_lanes: 1,
		carry: CARRY,
		is_stopped: false,
		...extra,
	})

	return children.map((item) => {
		const reason = reason_of(item, [])

		return [reason?.icon, reason?.since_ms]
	})
}

describe('run_board_reason.reader — the row a planning run is for', () => {
	it('says planning, with its time, on the declared head alone', () => {
		expect(rows()).toStrictEqual([
			[NAMED_ORDER, undefined],
			[PLANNING, Date.parse(PLANNED_AT)],
		])
	})

	it('says planning on the plan’s first waiting row where the run names no issues', () => {
		expect(rows({ carry: undefined })).toStrictEqual([
			[PLANNING, Date.parse(PLANNED_AT)],
			[undefined, undefined],
		])
	})

	it('says the lane’s own stage once the lane opens', () => {
		const opening = setup(2, OPENING_AT, run_event_setup.opening_lane(String(HEAD)))

		expect(rows({ events: [...PLANNING_EVENTS, opening] })).toStrictEqual([
			[NAMED_ORDER, undefined],
			[OPENING, Date.parse(OPENING_AT)],
		])
	})

	it('says nothing of planning once the run has stopped', () => {
		expect(rows({ is_stopped: true })).toStrictEqual([
			[NAMED_ORDER, undefined],
			[undefined, undefined],
		])
	})
})
