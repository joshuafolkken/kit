import type { IssueState } from '#scripts/issue/issue-state'
import { describe, expect, it } from 'vitest'
import type { RunCarry } from './run-carry'
import { run_merge } from './run-merge'

// joshuafolkken/kit#2024: the pure decisions a `run:merge` composite makes over a returned child.
// These pin the five outcomes the CLI branches on without a network — the branches the acceptance
// criteria name (merged / needs-decision parked / failed) are decided here, as is the failure guard
// the `stop` verdict rests on.

const CLOSED = 'CLOSED'
const NEEDS_DECISION = 'needs-decision'
const ALREADY_DONE = 'already-done'
const NEEDS_HUMAN_REVIEW = 'needs-human-review'
const IN_PROGRESS = 'in-progress'
const HUMAN_REVIEW = 'human-review'

function issue_state_of(over: Partial<IssueState>): IssueState {
	return { state: 'OPEN', labels: [], is_human_review: false, ...over }
}

describe('classify_child', () => {
	it('reads a CLOSED child as merged', () => {
		expect(run_merge.classify_child(issue_state_of({ state: CLOSED }))).toBe('merged')
	})

	it('reads a CLOSED child as merged even carrying needs-human-review', () => {
		const closed = issue_state_of({
			state: CLOSED,
			labels: [NEEDS_HUMAN_REVIEW],
			is_human_review: true,
		})

		expect(run_merge.classify_child(closed)).toBe('merged')
	})

	it('reads an OPEN human-review child as the run’s own ending', () => {
		const open = issue_state_of({ labels: [NEEDS_HUMAN_REVIEW], is_human_review: true })

		expect(run_merge.classify_child(open)).toBe(HUMAN_REVIEW)
	})

	it('reads an OPEN needs-decision child as parked', () => {
		expect(run_merge.classify_child(issue_state_of({ labels: [NEEDS_DECISION] }))).toBe('parked')
	})

	it('reads an OPEN already-done child as parked', () => {
		expect(run_merge.classify_child(issue_state_of({ labels: [ALREADY_DONE] }))).toBe('parked')
	})

	it('reads an OPEN child with neither label as failed', () => {
		expect(run_merge.classify_child(issue_state_of({ labels: [IN_PROGRESS] }))).toBe('failed')
	})

	it('reads an unreadable state as unresolved', () => {
		expect(run_merge.classify_child(undefined)).toBe('unresolved')
	})
})

describe('change_of', () => {
	it('counts a merge, which resets the failure streak', () => {
		expect(run_merge.change_of('merged')).toStrictEqual({ merged: 1 })
	})

	it('counts a failure', () => {
		expect(run_merge.change_of('failed')).toStrictEqual({ failures: 1 })
	})

	it('counts nothing for a parked child', () => {
		expect(run_merge.change_of('parked')).toBeUndefined()
	})

	it('counts nothing for a human-review child', () => {
		expect(run_merge.change_of(HUMAN_REVIEW)).toBeUndefined()
	})
})

describe('is_guard_tripped', () => {
	it('trips at the consecutive-failure limit', () => {
		expect(run_merge.is_guard_tripped(run_merge.CONSECUTIVE_FAILURE_LIMIT)).toBe(true)
	})

	it('holds below the limit', () => {
		expect(run_merge.is_guard_tripped(run_merge.CONSECUTIVE_FAILURE_LIMIT - 1)).toBe(false)
	})
})

describe('counters_comment', () => {
	it('renders every counter from the carry record', () => {
		const carry: RunCarry = {
			invocation: 'backlogrun',
			started_at: '2026-09-15T00:00:00.000Z',
			merged: 4,
			filed: 2,
			cuts: 1,
			failures: 1,
		}
		const comment = run_merge.counters_comment(carry)

		expect(comment).toContain('merged: 4')
		expect(comment).toContain('consecutive failures: 1')
	})
})
