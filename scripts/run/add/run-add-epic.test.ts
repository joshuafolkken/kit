import { EPIC_LABEL } from '#scripts/issue/issue-labels'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { describe, expect, it } from 'vitest'
import { run_add_epic } from './run-add-epic'

// joshuafolkken/kit#6840: an epic `run:add` hands a live run is a root the run tracks, recorded
// once and never labelled.

const EPIC = 6835
const DECLARED = 1762
const ADDED = 3433
const DONE = 3434

function carry_of(invocation: string): RunCarry {
	return {
		invocation,
		merged: 0,
		filed: 0,
		cuts: 0,
		failures: 0,
		outages: 0,
		started_at: new Date().toISOString(),
		added: [{ issue: ADDED, is_priority: true }],
		done: [DONE],
	}
}

describe('is_epic', () => {
	it('reads the epic label, in any case', () => {
		expect(run_add_epic.is_epic([EPIC_LABEL.toUpperCase()])).toBe(true)
		expect(run_add_epic.is_epic([])).toBe(false)
	})
})

describe('tracked_of', () => {
	it('holds the declared and added roots of a named run, not a done one', () => {
		const tracked = run_add_epic.tracked_of(
			carry_of(`backlogrun #${String(DECLARED)} #${String(DONE)}`),
		)

		expect(tracked).toStrictEqual(new Set([ADDED, DECLARED]))
	})

	it('holds the added roots of a pool run', () => {
		expect([...run_add_epic.tracked_of(carry_of('backlogrun'))]).toStrictEqual([ADDED])
	})
})

describe('track', () => {
	it('is new unless the run already tracks the root', () => {
		expect(run_add_epic.track(EPIC)).toStrictEqual({ kind: 'tracked', issue: EPIC, is_new: true })
		expect(run_add_epic.track(EPIC, new Set([EPIC])).is_new).toBe(false)
	})
})

describe('describe', () => {
	it.each([
		{ is_new: true, is_priority: true, line: 'tracking #6835 · epic root, ahead of the queue' },
		{ is_new: true, is_priority: false, line: 'tracking #6835 · epic root, end of the queue' },
		{ is_new: false, is_priority: true, line: 'tracking #6835 · already a root of this run' },
	])('says $line', ({ is_new, is_priority, line }) => {
		expect(run_add_epic.describe('#6835', is_new, is_priority)).toBe(line)
	})
})
