import {
	NEEDS_HUMAN_MERGE_LABEL,
	NEEDS_HUMAN_REVIEW_LABEL,
	RUN_LANE_LABEL,
} from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { run_board_decision_rows } from './run-board-decision-rows'
import type { BoardPlan, BoardRow, DecisionBlocker } from './run-board-layout-types'

const REPO = 'joshuafolkken/kit'
const MERGE_WAIT = 7975
const MERGE_PR = 7981
const HELD = [7976, 7977, 7980] as const
const OUTSIDE = 7491
const OUTSIDE_BLOCKER = 7488
const OUTSIDE_PR = 7498
const PREPARED = 8031
const PREPARED_HELD = 8030
const TITLE = 'Blocker title'
const DECIDE_TAIL = '→ decide: why'
const TAKE_TAIL = '→ take into a run (blocks #8030)'
const LANE = '/work/.kit-lanes/8031'
const STOPPED_MS = Date.parse('2026-11-21T09:00:00Z')

function blocker(
	number: number,
	need: DecisionBlocker['need'],
	blocks: ReadonlyArray<number>,
): DecisionBlocker {
	return { number, title: TITLE, labels: [RUN_LANE_LABEL], need, blocks }
}

function plan_of(blockers: Array<DecisionBlocker>, prs: ReadonlyMap<number, number>): BoardPlan {
	return {
		waves: { waves: [], unreached: [] },
		tracked: new Map(),
		context: { repo: REPO, titles: new Map(), open_numbers: new Set() },
		labels: new Map(),
		decision_blockers: blockers,
		human_merge_prs: prs,
	}
}

function tail_of(
	plan: BoardPlan,
	drawn: ReadonlySet<number> = new Set(),
): Array<string | undefined> {
	return run_board_decision_rows.rows_of(plan, drawn).map((item) => item.reason?.tail)
}

function prepared_tail(need: DecisionBlocker['need']): Array<string | undefined> {
	return tail_of(plan_of([blocker(PREPARED, need, [PREPARED_HELD])], new Map()))
}

function row(number: number, state: BoardRow['state']): BoardRow {
	const reason = { tail: DECIDE_TAIL }

	return {
		number,
		title: TITLE,
		kind: undefined,
		priority: undefined,
		state,
		status: undefined,
		waits: [],
		reason,
	}
}

describe('run_board_decision_rows.rows_of (joshuafolkken/kit#8026)', () => {
	it('draws a merge wait once with every child it holds (ac-9e1a93ee, ac-d3b91219)', () => {
		const merge = { ...blocker(MERGE_WAIT, 'merge', HELD), labels: [NEEDS_HUMAN_MERGE_LABEL] }
		const plan = plan_of([merge], new Map([[MERGE_WAIT, MERGE_PR]]))

		expect(run_board_decision_rows.rows_of(plan, new Set())).toMatchObject([
			{
				number: MERGE_WAIT,
				state: 'human',
				reason: { icon: '🔏', tail: '→ merge PR #7981 (blocks #7976, #7977, #7980)' },
			},
		])
	})

	it('names the open pull request of an outside blocker as what to merge (ac-fd16f6c9)', () => {
		const plan = plan_of(
			[blocker(OUTSIDE_BLOCKER, 'take', [OUTSIDE])],
			new Map([[OUTSIDE_BLOCKER, OUTSIDE_PR]]),
		)

		expect(tail_of(plan)).toStrictEqual(['→ merge PR #7498 (blocks #7491)'])
	})

	it.each([
		['publish', '→ publish (blocks #8030)'],
		['take', TAKE_TAIL],
		['decide', '→ decide (blocks #8030)'],
	] as const)('says what a person does for a %s blocker with no pull request', (need, tail) => {
		expect(prepared_tail(need)).toStrictEqual([tail])
	})

	it('leaves a blocker the run already draws to its own row', () => {
		const plan = plan_of([blocker(PREPARED, 'decide', [PREPARED_HELD])], new Map())

		expect(tail_of(plan, new Set([PREPARED]))).toStrictEqual([])
	})
})

// joshuafolkken/kit#8527: a blocker held at a review stop — labelled, its lane stopped — says to review
// its lane's changes; the label alone, which stands before the run, leaves it a blocker to take.
describe('run_board_decision_rows.rows_of — a review stop', () => {
	const labelled = {
		...blocker(PREPARED, 'take', [PREPARED_HELD]),
		labels: [NEEDS_HUMAN_REVIEW_LABEL],
	}

	it('says to review the changes in the stopped lane', () => {
		const stop = { stopped_ms: STOPPED_MS, directory: LANE }
		const plan = {
			...plan_of([labelled], new Map()),
			review_stops: new Map([[PREPARED, stop]]),
			now_ms: STOPPED_MS,
		}

		expect(tail_of(plan)).toStrictEqual([
			`→ review the uncommitted changes in ${LANE} (stopped 0″ ago) (blocks #8030)`,
		])
	})

	it('says to take the blocker into a run when its lane has not stopped', () => {
		const plan = plan_of([labelled], new Map())

		expect(tail_of(plan)).toStrictEqual([TAKE_TAIL])
	})
})

describe('run_board_decision_rows.held', () => {
	it('adds the held children to a person row only', () => {
		const plan = plan_of([blocker(PREPARED, 'decide', [PREPARED_HELD])], new Map())
		const rows = run_board_decision_rows.held(
			[row(PREPARED, 'human'), row(PREPARED_HELD, 'waiting')],
			plan,
		)

		expect(rows.map((item) => item.reason?.tail)).toStrictEqual([
			`${DECIDE_TAIL} (blocks #8030)`,
			DECIDE_TAIL,
		])
	})
})
