import type { EpicChild } from '#scripts/epic/epic-graph'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { describe, expect, it } from 'vitest'
import { run_board_labels } from './run-board-labels'
import type { BoardPlan, RowReason } from './run-board-layout'
import { run_board_reason, type ReasonRead } from './run-board-reason'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#8953: the named issues run side by side, so no queued row waits on the one typed
// before it — a named row draws no 📋 mark, only the pool's own reasons.

const REPO = 'joshuafolkken/kit'
const FIRST = 4199
const RUNNING = 4198
const THIRD = 4201
const FOURTH = 4200
const ADDED = 4300
const NO_LANE_LEFT = 0
const ONE_LANE_LEFT = 1
const NOW_MS = Date.parse('2026-10-19T00:10:00.000Z')
const { WAIT_ICONS } = run_board_labels
const CARRY: RunCarry = {
	invocation: `backlogrun #${String(FIRST)} #${String(RUNNING)} #${String(THIRD)} #${String(FOURTH)} --only`,
	started_at: '2026-10-19T00:00:00.000Z',
	merged: 1,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
	done: [FIRST],
	added: [{ issue: ADDED, is_priority: false }],
}
const STATUSES = new Map<number, ItemStatus>([[RUNNING, { state: 'running' }]])
const ROWS = [THIRD, FOURTH, ADDED]

function child(number: number): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels: [RUN_LANE_LABEL], blocked_by: [] }
}

function plan_of(children: Array<EpicChild>): BoardPlan {
	const numbers = children.map((item) => item.number)

	return {
		waves: { waves: [children], unreached: [] },
		tracked: new Map(),
		context: { repo: REPO, titles: new Map(), open_numbers: new Set(numbers) },
		labels: new Map(),
	}
}

function reasons(extra: Partial<ReasonRead> = {}): Array<RowReason | undefined> {
	const children = ROWS.map((number) => child(number))
	const reason_of = run_board_reason.reader({
		plan: plan_of(children),
		statuses: STATUSES,
		events: [],
		free_lanes: ONE_LANE_LEFT,
		carry: CARRY,
		is_stopped: false,
		now_ms: NOW_MS,
		...extra,
	})

	return children.map((item) => reason_of(item, []))
}

describe('run_board_reason.reader — named rows in a parallel named run', () => {
	it('draws no declared-order mark while a lane is free', () => {
		expect(reasons()).toStrictEqual([undefined, undefined, undefined])
	})

	it('names the full pool on every row, named or added', () => {
		const full: RowReason = { icon: WAIT_ICONS.lane, value: '1/1' }

		expect(reasons({ free_lanes: NO_LANE_LEFT, lane_limit: 1, occupied_count: 1 })).toStrictEqual([
			full,
			full,
			full,
		])
	})

	it('draws no declared-order mark before the first named issue starts', () => {
		expect(reasons({ statuses: new Map() })).toStrictEqual([undefined, undefined, undefined])
	})

	it('leaves a run that names no issues as it was', () => {
		const carry = { ...CARRY, invocation: 'backlogrun' }

		expect(reasons({ carry })).toStrictEqual([undefined, undefined, undefined])
		expect(reasons({ carry: undefined })).toStrictEqual([undefined, undefined, undefined])
	})
})
