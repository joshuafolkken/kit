import type { EpicChild } from '#scripts/epic/epic-graph'
import { describe, expect, it } from 'vitest'
import { run_board_standing_waits } from './run-board-standing-waits'
import type { ItemStatus } from './run-board-status'

const REPO = 'joshuafolkken/kit'
const OTHER = 'joshuafolkken/other'
const CHILD = 10
const OPEN_BLOCKER = 20
const CLOSED_BLOCKER = 21
const MERGED_BLOCKER = 22
const FOREIGN_BLOCKER = 7

const CHILD_ROW: EpicChild = {
	number: CHILD,
	repo: REPO,
	state: 'OPEN',
	labels: [],
	blocked_by: [
		{ repo: REPO, number: OPEN_BLOCKER },
		{ repo: REPO, number: CLOSED_BLOCKER },
		{ repo: REPO, number: MERGED_BLOCKER },
		{ repo: OTHER, number: FOREIGN_BLOCKER },
	],
}

const SOURCE = {
	plan: {
		context: {
			repo: REPO,
			titles: new Map<number, string>(),
			open_numbers: new Set([CHILD, OPEN_BLOCKER, MERGED_BLOCKER]),
		},
	},
	statuses: new Map<number, ItemStatus>([[MERGED_BLOCKER, { state: 'merged' }]]),
}

describe('run_board_standing_waits.waits_of', () => {
	it('names each blocker still open and not merged since the plan was read', () => {
		expect(run_board_standing_waits.waits_of(CHILD_ROW, SOURCE)).toStrictEqual([
			String(OPEN_BLOCKER),
			`other#${String(FOREIGN_BLOCKER)}`,
		])
	})

	// A closed upstream Issue still holds the child until its release lands, so it stays named.
	it('names another owner’s blocker with its owner, and keeps one its relation read closed', () => {
		const row: EpicChild = {
			...CHILD_ROW,
			blocked_by: [
				{ repo: 'someone/repo', number: FOREIGN_BLOCKER },
				{ repo: OTHER, number: OPEN_BLOCKER, state: 'CLOSED' },
			],
		}

		expect(run_board_standing_waits.waits_of(row, SOURCE)).toStrictEqual([
			`someone/repo#${String(FOREIGN_BLOCKER)}`,
			`other#${String(OPEN_BLOCKER)}`,
		])
	})
})

describe('run_board_standing_waits.of_touched', () => {
	const waits = new Map([[CHILD, ['other#7']]])

	it('draws a waiting lane row’s standing blockers, and none on any other state', () => {
		expect(run_board_standing_waits.of_touched(CHILD, { state: 'waiting' }, waits)).toStrictEqual([
			'other#7',
		])
		expect(run_board_standing_waits.of_touched(CHILD, { state: 'running' }, waits)).toStrictEqual(
			[],
		)
	})
})

describe('run_board_standing_waits.is_upstream_held', () => {
	const { context } = SOURCE.plan

	it('holds a child on a standing blocker in another repository only', () => {
		expect(run_board_standing_waits.is_upstream_held(CHILD_ROW, context)).toBe(true)
		expect(
			run_board_standing_waits.is_upstream_held({ ...CHILD_ROW, blocked_by: [] }, context),
		).toBe(false)
	})
})

describe('run_board_standing_waits.by_number', () => {
	it('keys each child by its number with its standing blockers', () => {
		const waits = run_board_standing_waits.by_number([CHILD_ROW], SOURCE)

		expect(waits.get(CHILD)).toStrictEqual(run_board_standing_waits.waits_of(CHILD_ROW, SOURCE))
	})
})
