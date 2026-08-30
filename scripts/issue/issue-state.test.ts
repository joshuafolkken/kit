import { describe, expect, it } from 'vitest'
import { issue_state } from './issue-state'

const IN_PROGRESS = 'in-progress'
const CLOSED_JSON = `{"state":"CLOSED","labels":[{"name":"${IN_PROGRESS}"}]}`

describe('issue_state.parse_issue_state', () => {
	it('reads the state in the spelling the documents compare against', () => {
		expect(issue_state.parse_issue_state(CLOSED_JSON)?.state).toBe('CLOSED')
	})

	it('reduces the label objects to their names', () => {
		expect(issue_state.parse_issue_state(CLOSED_JSON)?.labels).toEqual([IN_PROGRESS])
	})

	it('treats an absent labels field as no labels rather than as a failure', () => {
		expect(issue_state.parse_issue_state('{"state":"OPEN"}')?.labels).toEqual([])
	})

	// A read that answered something other than an issue must not print as a state: the caller reads
	// the first line to decide whether a delegated child finished.
	it('returns undefined when the response carries no state', () => {
		expect(issue_state.parse_issue_state('{"message":"API rate limit exceeded"}')).toBeUndefined()
	})

	it('returns undefined for text that is not JSON at all', () => {
		expect(issue_state.parse_issue_state('not json')).toBeUndefined()
	})
})

describe('issue_state.format_issue_state', () => {
	it('prints the state first, so the verdict is the first line', () => {
		const report = issue_state.format_issue_state({ state: 'CLOSED', labels: [] })

		expect(report.split('\n', 1)[0]).toBe('state: CLOSED')
	})

	it('joins several labels on one line', () => {
		const report = issue_state.format_issue_state({
			state: 'OPEN',
			labels: [IN_PROGRESS, 'needs-decision'],
		})

		expect(report).toContain(`labels: ${IN_PROGRESS}, needs-decision`)
	})

	// An empty tail after `labels:` is indistinguishable from a truncated answer, and the caller uses
	// this line to tell a parked child from a failed one.
	it('names the empty case rather than printing an empty tail', () => {
		expect(issue_state.format_issue_state({ state: 'OPEN', labels: [] })).toContain(
			`labels: ${issue_state.NO_LABELS}`,
		)
	})
})
