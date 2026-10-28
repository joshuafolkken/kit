import type { EpicChild } from '#scripts/epic/epic-graph'
import {
	IN_PROGRESS_LABEL,
	NEEDS_DECISION_LABEL,
	RUN_LANE_LABEL,
	RUN_SOLO_LABEL,
} from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { run_board_labels } from './run-board-labels'
import type { BoardPlan, RowReason } from './run-board-layout'
import { run_board_reason } from './run-board-reason'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#4294: a `run:solo` issue waiting for the running lanes leads its row with 🧍 and
// those lanes, and every row behind it with 🙅 and its number — `epic_solo`'s reading, not the board's.

const REPO = 'joshuafolkken/kit'
const SOLO = 4287
const BEHIND = 4269
const LATER = 4292
const AHEAD = 4250
const FIRST_LANE = 4288
const SECOND_LANE = 4268
const BLOCKER = 4100
const FUTURE = '2999-01-01T00:00Z'
const NOW_MS = Date.parse('2026-10-20T00:00:00.000Z')
const SOON = '2026-10-21T00:00Z'
const { WAIT_ICONS } = run_board_labels
const BEHIND_SOLO: RowReason = { icon: WAIT_ICONS.solo_ahead, issues: [String(SOLO)] }

function child(
	number: number,
	labels = [RUN_LANE_LABEL],
	blocked_by: Array<number> = [],
): EpicChild {
	const edges = blocked_by.map((blocker) => ({ repo: REPO, number: blocker }))

	return { number, repo: REPO, state: 'OPEN', labels, blocked_by: edges }
}

function solo(): EpicChild {
	return child(SOLO, [RUN_SOLO_LABEL])
}

function plan_of(children: Array<EpicChild>): BoardPlan {
	const open_numbers = new Set([...children.map((item) => item.number), BLOCKER])

	return {
		waves: { waves: [children], unreached: [] },
		tracked: new Map(),
		context: { repo: REPO, titles: new Map(), open_numbers },
		labels: new Map(),
	}
}

function running(lanes: ReadonlyArray<number>): Map<number, ItemStatus> {
	return new Map(lanes.map((lane) => [lane, { state: 'running' }]))
}

function reasons(
	children: Array<EpicChild>,
	lanes: ReadonlyArray<number>,
): Array<RowReason | undefined> {
	const read = {
		plan: plan_of(children),
		statuses: running(lanes),
		events: [],
		free_lanes: 1,
		is_stopped: false,
		now_ms: NOW_MS,
	}
	const reason_of = run_board_reason.reader(read)

	return children.map((item) => reason_of(item, []))
}

describe('run_board_reason.reader on a run:solo candidate', () => {
	it('leads the solo row with 🧍 and the one lane it waits for', () => {
		const [solo_reason] = reasons([solo()], [FIRST_LANE])

		expect(solo_reason).toStrictEqual({ icon: WAIT_ICONS.solo, issues: [String(FIRST_LANE)] })
	})

	it('names every running lane, the first in the column and the rest after the title', () => {
		const [solo_reason] = reasons([solo()], [FIRST_LANE, SECOND_LANE])

		expect(solo_reason?.issues).toStrictEqual([String(FIRST_LANE), String(SECOND_LANE)])
	})

	it('leads every candidate behind it with 🙅 and the solo issue', () => {
		const rows = reasons([solo(), child(BEHIND), child(LATER)], [FIRST_LANE])

		expect(rows.slice(1)).toStrictEqual([BEHIND_SOLO, BEHIND_SOLO])
	})

	it('leaves a candidate ranked ahead of the solo issue to its own reason', () => {
		const [ahead, solo_reason, behind] = reasons(
			[child(AHEAD), solo(), child(BEHIND)],
			[FIRST_LANE],
		)

		expect(ahead).toBeUndefined()
		expect(solo_reason?.icon).toBe(WAIT_ICONS.solo)
		expect(behind).toStrictEqual(BEHIND_SOLO)
	})

	it('draws no 🧍 where no lane runs, but still holds the rows behind it', () => {
		const [solo_reason, behind] = reasons([solo(), child(BEHIND)], [])

		expect(solo_reason).toBeUndefined()
		expect(behind).toStrictEqual(BEHIND_SOLO)
	})

	it('keeps a blocked row on its blocker rather than behind the solo issue', () => {
		const blocked = child(BEHIND, [RUN_LANE_LABEL], [BLOCKER])
		const read = reasons([solo(), blocked], [FIRST_LANE])

		expect(read[1]).toBeUndefined()
	})
})

// joshuafolkken/kit#4391: a running `run:solo` issue lets nothing new start, so every candidate row —
// a waiting `run:solo` one too — leads with 🔒 and the holder, `epic_solo.holder_of`'s reading.
const HOLDER = 4374
const HELD: RowReason = { icon: WAIT_ICONS.solo_running, issues: [String(HOLDER)] }
const HOLDING = [IN_PROGRESS_LABEL, RUN_SOLO_LABEL]

function held_reasons(
	children: Array<EpicChild>,
	waits: ReadonlyArray<string> = [],
	holder_labels: ReadonlyArray<string> = HOLDING,
	lanes: ReadonlyArray<number> = [HOLDER],
): Array<RowReason | undefined> {
	const plan = { ...plan_of(children), labels: new Map([[HOLDER, holder_labels]]) }
	const read = {
		plan,
		statuses: running(lanes),
		events: [],
		free_lanes: 1,
		is_stopped: false,
		now_ms: NOW_MS,
	}
	const reason_of = run_board_reason.reader(read)

	return children.map((item) => reason_of(item, waits))
}

describe('run_board_reason.reader while a run:solo issue runs', () => {
	it('leads every candidate row with 🔒 and the holder, a solo candidate too', () => {
		expect(held_reasons([child(AHEAD), solo(), child(BEHIND)])).toStrictEqual([HELD, HELD, HELD])
	})

	it('keeps 🔒 for an in-progress run:solo issue outside this run’s lanes, as backlog:next holds', () => {
		expect(held_reasons([child(AHEAD)], [], HOLDING, [])).toStrictEqual([HELD])
	})

	it('drops 🔒 for a parked run:solo issue, which backlog:next no longer reads as holding', () => {
		const [reason] = held_reasons([child(AHEAD)], [], [...HOLDING, NEEDS_DECISION_LABEL], [])

		expect(reason).toBeUndefined()
	})

	it('leaves a running issue without run:solo to the rows’ own reasons', () => {
		const [solo_reason] = held_reasons([solo()], [], [IN_PROGRESS_LABEL, RUN_LANE_LABEL])

		expect(solo_reason).toStrictEqual({ icon: WAIT_ICONS.solo, issues: [String(HOLDER)] })
	})

	it('keeps a blocked, an untriaged and a not-yet-due row on their own reasons', () => {
		const [blocked] = held_reasons([child(BEHIND)], [String(BLOCKER)])
		const [untriaged] = held_reasons([child(LATER, [])])
		const [later] = held_reasons([
			{ ...child(AHEAD), body: `## 背景\n\n- 実施可能日: ${FUTURE}\n` },
		])

		expect(blocked).toStrictEqual({ icon: WAIT_ICONS.blocker, issues: [String(BLOCKER)] })
		expect(untriaged?.icon).toBe(WAIT_ICONS.untriaged)
		expect(later?.icon).toBe(WAIT_ICONS.not_before)
	})
})

describe('run_board_reason.reader on a run:solo issue not yet due', () => {
	it('holds nothing behind it, as backlog:next leaves it out of the candidates', () => {
		const later_solo = { ...solo(), body: `## 背景\n\n- 実施可能日: ${FUTURE}\n` }
		const [solo_reason, behind] = reasons([later_solo, child(BEHIND)], [FIRST_LANE])

		expect(solo_reason?.icon).toBe(WAIT_ICONS.not_before)
		expect(behind).toBeUndefined()
	})

	// joshuafolkken/kit#4848: due by the wall clock, not by the board's, so only the board's clock keeps it out.
	it('weighs its start time against the board’s clock, not the wall clock', () => {
		const soon_solo = { ...solo(), body: `## 背景\n\n- 実施可能日: ${SOON}\n` }
		const [, behind] = reasons([soon_solo, child(BEHIND)], [FIRST_LANE])

		expect(behind).toBeUndefined()
	})
})
