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
const MERGED = 'merged'
const PARKED = 'parked'
const OUTAGE = { is_outage: true, is_cut: false }
const CUT = { is_outage: false, is_cut: true }

function issue_state_of(over: Partial<IssueState>): IssueState {
	return { state: 'OPEN', labels: [], is_human_review: false, ...over }
}

describe('classify_child', () => {
	it('reads a CLOSED child as merged', () => {
		expect(run_merge.classify_child(issue_state_of({ state: CLOSED }))).toBe(MERGED)
	})

	it('reads a CLOSED child as merged even carrying needs-human-review', () => {
		const closed = issue_state_of({
			state: CLOSED,
			labels: [NEEDS_HUMAN_REVIEW],
			is_human_review: true,
		})

		expect(run_merge.classify_child(closed)).toBe(MERGED)
	})

	it('reads an OPEN human-review child as the run’s own ending', () => {
		const open = issue_state_of({ labels: [NEEDS_HUMAN_REVIEW], is_human_review: true })

		expect(run_merge.classify_child(open)).toBe(HUMAN_REVIEW)
	})

	it('reads an OPEN needs-decision child as parked', () => {
		expect(run_merge.classify_child(issue_state_of({ labels: [NEEDS_DECISION] }))).toBe(PARKED)
	})

	it('reads an OPEN already-done child as parked', () => {
		expect(run_merge.classify_child(issue_state_of({ labels: [ALREADY_DONE] }))).toBe(PARKED)
	})

	it('reads an OPEN child with neither label as failed', () => {
		expect(run_merge.classify_child(issue_state_of({ labels: [IN_PROGRESS] }))).toBe('failed')
	})

	// joshuafolkken/kit#2240: an OPEN, unparked child whose exit record shows it could not reach the API
	// is an outage, not a failure — the distinction the parent needs to leave it re-dispatchable.
	it('reads an OPEN unparked child as an outage when the exit record is an outage', () => {
		expect(run_merge.classify_child(issue_state_of({ labels: [IN_PROGRESS] }), OUTAGE)).toBe(
			'outage',
		)
	})

	it('reads an unreadable state as unresolved', () => {
		expect(run_merge.classify_child(undefined)).toBe('unresolved')
	})
})

// is_outage only splits the failed case: a CLOSED or parked child is what its state says regardless of
// the exit record (joshuafolkken/kit#2240).
describe('classify_child — is_outage is ignored outside the failed case', () => {
	it.each([
		{ over: { state: CLOSED }, expected: 'merged' },
		{ over: { labels: [ALREADY_DONE] }, expected: 'parked' },
	])('classifies $expected regardless of an outage exit record', ({ over, expected }) => {
		expect(run_merge.classify_child(issue_state_of(over), OUTAGE)).toBe(expected)
	})
})

// joshuafolkken/kit#2484: a child that ended its session with a declared cut its successor never adopted
// is resumed, not parked — and only an OPEN, unparked child is read that way.
describe('classify_child — a declared cut', () => {
	it('reads an OPEN unparked child as a cut when its lane holds an unadopted cut', () => {
		expect(run_merge.classify_child(issue_state_of({ labels: [IN_PROGRESS] }), CUT)).toBe('cut')
	})

	it('reads a cut before an outage exit record', () => {
		const signals = { is_outage: true, is_cut: true }

		expect(run_merge.classify_child(issue_state_of({ labels: [IN_PROGRESS] }), signals)).toBe('cut')
	})

	it.each([
		{ over: { state: CLOSED }, expected: MERGED },
		{ over: { labels: [NEEDS_DECISION] }, expected: PARKED },
	])('classifies $expected regardless of a carried cut', ({ over, expected }) => {
		expect(run_merge.classify_child(issue_state_of(over), CUT)).toBe(expected)
	})

	it('counts nothing for a cut child', () => {
		expect(run_merge.change_of('cut')).toBeUndefined()
	})
})

describe('change_of', () => {
	it('counts a merge, which resets the failure streak', () => {
		expect(run_merge.change_of('merged')).toStrictEqual({ merged: 1 })
	})

	it('counts a failure', () => {
		expect(run_merge.change_of('failed')).toStrictEqual({ failures: 1 })
	})

	// An outage is counted into its own streak, never against the failure count (joshuafolkken/kit#2240).
	it('counts an outage into the outage streak, not the failure streak', () => {
		expect(run_merge.change_of('outage')).toStrictEqual({ outages: 1 })
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

// joshuafolkken/kit#2240: the outage guard is the same shape over its own streak — a run of consecutive
// API outages is the environment being down, and the run stops rather than re-dispatching forever.
describe('is_outage_guard_tripped', () => {
	it('trips at the consecutive-outage limit', () => {
		expect(run_merge.is_outage_guard_tripped(run_merge.CONSECUTIVE_OUTAGE_LIMIT)).toBe(true)
	})

	it('holds below the outage limit', () => {
		expect(run_merge.is_outage_guard_tripped(run_merge.CONSECUTIVE_OUTAGE_LIMIT - 1)).toBe(false)
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
			outages: 2,
		}
		const comment = run_merge.counters_comment(carry)

		expect(comment).toContain('merged: 4')
		expect(comment).toContain('consecutive failures: 1')
		expect(comment).toContain('consecutive outages: 2')
	})
})
