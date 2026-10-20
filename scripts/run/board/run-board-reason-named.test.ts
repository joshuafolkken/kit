import type { EpicChild } from '#scripts/epic/epic-graph'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { describe, expect, it } from 'vitest'
import type { BoardPlan } from './run-board-layout'
import { run_board_reason, type ReasonRead } from './run-board-reason'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#4206: `backlogrun 4199 4198 4201 4200 --only` held 4201 and 4200 behind a running
// 4198, and their queued rows said `next free lane` or nothing at all.

const REPO = 'joshuafolkken/kit'
const FIRST = 4199
const RUNNING = 4198
const THIRD = 4201
const FOURTH = 4200
const ADDED = 4300
const NO_LANE_LEFT = 0
const ONE_LANE_LEFT = 1
const NO_LANE_WORD = 'next free lane'
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

function reasons(extra: Partial<ReasonRead> = {}): Array<unknown> {
	const children = ROWS.map((number) => child(number))
	const reason_of = run_board_reason.reader({
		plan: plan_of(children),
		statuses: STATUSES,
		events: [],
		free_lanes: ONE_LANE_LEFT,
		carry: CARRY,
		is_stopped: false,
		...extra,
	})

	return children.map((item) => reason_of(item)?.text)
}

describe('run_board_reason.reader — a row the declared order keeps waiting', () => {
	it('names the declared issue each queued row starts after', () => {
		expect(reasons()).toStrictEqual([
			`after ${String(RUNNING)} · named order`,
			`after ${String(THIRD)} · named order`,
			undefined,
		])
	})

	it('says the declared order before a full pool, which only an added row waits on', () => {
		expect(reasons({ free_lanes: NO_LANE_LEFT, lane_limit: 1, occupied_count: 1 })).toStrictEqual([
			`after ${String(RUNNING)} · named order`,
			`after ${String(THIRD)} · named order`,
			`${NO_LANE_WORD} (1/1)`,
		])
	})

	// joshuafolkken/kit#4279: `backlogrun #4263 #4262 --only` left 4262's row blank before 4263 started.
	it('names the declared order before its first issue starts', () => {
		expect(reasons({ statuses: new Map() })).toStrictEqual([
			`after ${String(RUNNING)} · named order`,
			`after ${String(THIRD)} · named order`,
			undefined,
		])
	})

	it('leaves a run that names no issues as it was', () => {
		const carry = { ...CARRY, invocation: 'backlogrun' }

		expect(reasons({ carry })).toStrictEqual([undefined, undefined, undefined])
		expect(reasons({ carry: undefined })).toStrictEqual([undefined, undefined, undefined])
	})
})
