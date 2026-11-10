import { issue_human_stops } from '#scripts/issue/issue-human-stops'
import { NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_human } from './run-board-human'

const ADDED_STOP_LABEL = 'needs-new-stop'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_human.human_labels', () => {
	it('splits every registry label between the 🙋 state and a place the board draws it elsewhere', () => {
		const human = run_board_human.human_labels()
		const elsewhere = [...run_board_human.DRAWN_ELSEWHERE.keys()]

		expect(new Set([...human, ...elsewhere])).toEqual(issue_human_stops.labels())
		expect(human.filter((label) => elsewhere.includes(label))).toEqual([])
	})

	it('draws a stop newly added to the registry as waiting on a person', () => {
		vi.spyOn(issue_human_stops, 'labels').mockReturnValue(
			new Set([...issue_human_stops.labels(), ADDED_STOP_LABEL]),
		)

		expect(run_board_human.is_human([ADDED_STOP_LABEL])).toBe(true)
		expect(run_board_human.is_decision(`parked: ${ADDED_STOP_LABEL}`)).toBe(true)
	})
})

describe('run_board_human.is_human', () => {
	it('reads needs-decision as waiting on a person', () => {
		expect(run_board_human.is_human([NEEDS_DECISION_LABEL])).toBe(true)
	})

	it.each([...run_board_human.DRAWN_ELSEWHERE.keys()])('leaves %s to its own drawing', (label) => {
		expect(run_board_human.is_human([label])).toBe(false)
	})
})

describe('run_board_human.is_decision', () => {
	it('reads a park reason naming a human-stop label as a decision', () => {
		expect(run_board_human.is_decision(`parked: ${NEEDS_DECISION_LABEL}`)).toBe(true)
	})

	it.each([undefined, 'run:stalled'])('reads %s as no decision', (reason) => {
		expect(run_board_human.is_decision(reason)).toBe(false)
	})
})
