import {
	NEEDS_DECISION_LABEL,
	NEEDS_HUMAN_REVIEW_LABEL,
	RUN_STALLED_LABEL,
} from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { run_board_parked_decision } from './run-board-parked-decision'
import type { ItemStatus } from './run-board-status'

const ISSUE = 8478
const BARE_PARK: ItemStatus = { state: 'parked', started_ms: 1 }
const WITHDRAWN: ItemStatus = { state: 'withdrawn', started_ms: 1 }

function read_of(labels: ReadonlyArray<string>): {
	titles: ReadonlyMap<number, string>
	labels: ReadonlyMap<number, ReadonlyArray<string>>
} {
	return { titles: new Map(), labels: new Map([[ISSUE, labels]]) }
}

describe('run_board_parked_decision.is_parked_decision', () => {
	it('reads a bare park whose issue carries needs-decision now as a decision', () => {
		const read = read_of(['bug', NEEDS_DECISION_LABEL])

		expect(run_board_parked_decision.is_parked_decision(ISSUE, BARE_PARK, read)).toBe(true)
	})

	it('keeps a bare park without a human-stop label off the decision rows', () => {
		const read = read_of([RUN_STALLED_LABEL])

		expect(run_board_parked_decision.is_parked_decision(ISSUE, BARE_PARK, read)).toBe(false)
	})

	it('still reads a park whose event names the decision label', () => {
		const status: ItemStatus = { state: 'parked', reason: NEEDS_DECISION_LABEL }

		expect(run_board_parked_decision.is_parked_decision(ISSUE, status, read_of([]))).toBe(true)
	})

	it('reads a bare park whose issue carries needs-human-review as a decision', () => {
		const read = read_of([NEEDS_HUMAN_REVIEW_LABEL])

		expect(run_board_parked_decision.is_parked_decision(ISSUE, BARE_PARK, read)).toBe(true)
	})

	it('reads no running row as a parked decision, whatever its labels', () => {
		const status: ItemStatus = { state: 'running', started_ms: 1 }
		const read = read_of([NEEDS_DECISION_LABEL])

		expect(run_board_parked_decision.is_parked_decision(ISSUE, status, read)).toBe(false)
	})
})

// joshuafolkken/kit#8578: a child withdrawn after its park still waits on a person while its issue is
// open and carries the label.
describe('run_board_parked_decision.is_parked_decision on a withdrawn child', () => {
	it.each([NEEDS_DECISION_LABEL, NEEDS_HUMAN_REVIEW_LABEL])(
		'reads an open withdrawn child carrying %s as a decision',
		(label) => {
			const read = read_of([label])

			expect(run_board_parked_decision.is_parked_decision(ISSUE, WITHDRAWN, read)).toBe(true)
		},
	)

	it('leaves an open withdrawn child without a human-stop label to the ending rows', () => {
		const read = read_of([RUN_STALLED_LABEL])

		expect(run_board_parked_decision.is_parked_decision(ISSUE, WITHDRAWN, read)).toBe(false)
	})

	it('leaves a closed withdrawn child to the ending rows, whatever its labels', () => {
		const closed: ItemStatus = { ...WITHDRAWN, outcome: { summary: 'not planned', url: '' } }
		const read = read_of([NEEDS_DECISION_LABEL])

		expect(run_board_parked_decision.is_parked_decision(ISSUE, closed, read)).toBe(false)
	})

	it('drops the decision on the next read once the label is removed', () => {
		const before = read_of([NEEDS_DECISION_LABEL])
		const after = read_of([])

		expect(run_board_parked_decision.is_parked_decision(ISSUE, WITHDRAWN, before)).toBe(true)
		expect(run_board_parked_decision.is_parked_decision(ISSUE, WITHDRAWN, after)).toBe(false)
	})
})
