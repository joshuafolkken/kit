import type { IssueState } from '#scripts/issue/issue-state'
import { describe, expect, it } from 'vitest'
import { run_next, type NextInput } from './run-next'
import type { PrepParts } from './run-prep'

const OPEN_STATE: IssueState = { state: 'OPEN', labels: [], is_human_review: false }
const REVIEW_STATE: IssueState = {
	state: 'OPEN',
	labels: ['needs-human-review'],
	is_human_review: true,
}
const CLOSED_STATE: IssueState = { state: 'CLOSED', labels: [], is_human_review: false }

function input(overrides: Partial<NextInput>): NextInput {
	return { state: 'OPEN', is_human_review: false, latest_scope: 'skip', ...overrides }
}

function parts(overrides: Partial<PrepParts>): PrepParts {
	return {
		issue_number: '2188',
		content_body: 'body',
		state: OPEN_STATE,
		state_failure: '',
		latest_scope: 'skip',
		latest_reason: 'window is 12h',
		...overrides,
	}
}

describe('run_next.next_step', () => {
	it('reports the implement step for an open issue with nothing owed', () => {
		expect(run_next.next_step(input({}))).toBe(run_next.IMPLEMENT_STEP)
	})

	it('reports the already-done step for a closed issue', () => {
		expect(run_next.next_step(input({ state: 'CLOSED' }))).toBe(run_next.ALREADY_DONE_STEP)
	})

	it('puts a required dependency update ahead of implementing', () => {
		expect(run_next.next_step(input({ latest_scope: 'required' }))).toBe(run_next.LATEST_STEP)
	})

	it('surfaces a needs-human-review stop ahead of the ordinary implement step', () => {
		expect(run_next.next_step(input({ is_human_review: true }))).toBe(run_next.HUMAN_REVIEW_STEP)
	})

	it('answers an unreadable state rather than falling through to implement', () => {
		expect(run_next.next_step(input({ state: undefined }))).toBe(run_next.UNKNOWN_STEP)
	})

	it('closed wins over a required update', () => {
		const step = run_next.next_step(input({ state: 'CLOSED', latest_scope: 'required' }))

		expect(step).toBe(run_next.ALREADY_DONE_STEP)
	})
})

describe('run_next.format_report', () => {
	it('maps a human-review issue through to its stop step', () => {
		expect(run_next.format_report(parts({ state: REVIEW_STATE }))).toBe(run_next.HUMAN_REVIEW_STEP)
	})

	it('maps a closed issue through to the already-done step', () => {
		expect(run_next.format_report(parts({ state: CLOSED_STATE }))).toBe(run_next.ALREADY_DONE_STEP)
	})

	it('maps a failed state read through to the unknown step', () => {
		expect(run_next.format_report(parts({ state: undefined }))).toBe(run_next.UNKNOWN_STEP)
	})
})
