import { describe, expect, it } from 'vitest'
import { backlog_listing_trace, type ListingOutcome } from './backlog-listing-trace'

// joshuafolkken/kit#7583: a waiting driver's log tells which step a missed wake fell at.

const UNCHANGED: ListingOutcome = 'unchanged'
const CHANGED: ListingOutcome = 'changed'
const NO_FREE_LANE: ListingOutcome = 'no-free-lane'

function line_of(outcome: ListingOutcome): string {
	return `listing check: ${outcome}`
}

function printed(outcomes: ReadonlyArray<ListingOutcome>): Array<string> {
	const lines: Array<string> = []
	const note = backlog_listing_trace.tracer((line) => {
		lines.push(line)
	})

	for (const outcome of outcomes) note(outcome)

	return lines.map((line) => line.replace(/ at .*$/u, ''))
}

describe('backlog_listing_trace.tracer', () => {
	it.each<ListingOutcome>([NO_FREE_LANE, UNCHANGED, CHANGED, 'failed'])(
		'prints a %s check',
		(outcome) => {
			expect(printed([outcome])).toStrictEqual([line_of(outcome)])
		},
	)

	it('prints a repeated outcome once, but every change', () => {
		const outcomes = [UNCHANGED, UNCHANGED, CHANGED, CHANGED, NO_FREE_LANE, NO_FREE_LANE]

		expect(printed(outcomes)).toStrictEqual(
			[UNCHANGED, CHANGED, CHANGED, NO_FREE_LANE].map((outcome) => line_of(outcome)),
		)
	})
})
