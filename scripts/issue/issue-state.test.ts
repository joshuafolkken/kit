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
		const report = issue_state.format_issue_state({
			state: 'CLOSED',
			labels: [],
			is_human_review: false,
		})

		expect(report.split('\n', 1)[0]).toBe('state: CLOSED')
	})

	it('joins several labels on one line', () => {
		const report = issue_state.format_issue_state({
			state: 'OPEN',
			labels: [IN_PROGRESS, 'needs-decision'],
			is_human_review: false,
		})

		expect(report).toContain(`labels: ${IN_PROGRESS}, needs-decision`)
	})

	// An empty tail after `labels:` is indistinguishable from a truncated answer, and the caller uses
	// this line to tell a parked child from a failed one.
	it('names the empty case rather than printing an empty tail', () => {
		expect(
			issue_state.format_issue_state({ state: 'OPEN', labels: [], is_human_review: false }),
		).toContain(`labels: ${issue_state.NO_LABELS}`)
	})
})

const OPEN_STATE = 'OPEN'
const HUMAN_REVIEW = 'needs-human-review'
const REVIEW_YES = 'human_review: yes'
const REVIEW_NO = 'human_review: no'

// One report for an open issue carrying exactly these labels, read the way the command reads it.
function report_for(...labels: ReadonlyArray<string>): string {
	const json = JSON.stringify({ state: OPEN_STATE, labels: labels.map((name) => ({ name })) })
	const parsed = issue_state.parse_issue_state(json)

	return parsed === undefined ? '' : issue_state.format_issue_state(parsed)
}

// joshuafolkken/kit#1132: `needs-human-review` is what stops a run before its commit, and it was the
// one workflow label with no runtime reader — an agent matched the string by eye. GitHub keeps the
// spelling a label was created with, so a repository whose label reads `Needs-Human-Review` produced
// a run that did not stop and an artifact that shipped.
describe('issue_state — the human-review line', () => {
	it('answers yes for an issue carrying the label', () => {
		expect(report_for(HUMAN_REVIEW)).toContain(REVIEW_YES)
	})

	it('answers no for an issue that does not', () => {
		expect(report_for(IN_PROGRESS)).toContain(REVIEW_NO)
	})

	it('answers no for an issue with no labels at all', () => {
		expect(report_for()).toContain(REVIEW_NO)
	})

	// The whole point of routing the decision through `has_any_label`.
	it('answers yes whatever case the label was created with', () => {
		expect(report_for('Needs-Human-Review')).toContain(REVIEW_YES)
	})

	// A near-miss is not the label; answering yes for one would stop runs nobody asked to stop.
	it('answers no for a different label that merely looks similar', () => {
		expect(report_for(`${HUMAN_REVIEW}-later`)).toContain(REVIEW_NO)
	})

	it('keeps the state and labels lines it already printed, in order', () => {
		const lines = report_for(HUMAN_REVIEW).split('\n')

		expect(lines[0]).toBe(`state: ${OPEN_STATE}`)
		expect(lines[1]).toBe(`labels: ${HUMAN_REVIEW}`)
		expect(lines[2]).toBe(REVIEW_YES)
	})
})
