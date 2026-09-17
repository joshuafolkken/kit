import { auto_ok_fixture } from '#scripts/auto-ok/auto-ok-fixture'
import { AUTO_OK_LABEL, EPIC_LABEL } from '#scripts/git/issue-labels'
import type { OpenIssueData } from '#scripts/git/schemas'
import { describe, expect, it } from 'vitest'
import { epic_index } from './epic-index'

// Two epics naming the same child is the case this suite exists for (joshuafolkken/kit#1694). A task
// list expresses at most one epic per row, but nothing stops two epics writing the same row, and the
// two questions asked of the tracking answer differently when they do.

const OPTED_IN_EPIC = 800
const OTHER_EPIC = 810
const CHILD = 42
const UNTRACKED_CHILD = 43
const CHILD_ROW = `- [ ] #${String(CHILD)}`
const CREATED_AT = '2026-08-01T00:00:00Z'

const { issue } = auto_ok_fixture

// A row of the opted-in listing that is itself an epic — the shape `opted_in_epic_numbers` reads.
function opted_in_epic_row(number: number): OpenIssueData {
	return issue(number, CREATED_AT, [AUTO_OK_LABEL, EPIC_LABEL])
}

// The collision itself: the opted-in epic first, so a collapsed index keeps the other one.
const COLLIDING_EPICS = [
	{ number: OPTED_IN_EPIC, body: CHILD_ROW },
	{ number: OTHER_EPIC, body: CHILD_ROW },
]

function both_epics_tracking_the_child(): ReadonlyMap<number, ReadonlyArray<number>> {
	return epic_index.build_tracking_index(COLLIDING_EPICS)
}

describe('epic_index.build_tracking_index', () => {
	it('records every epic that names the same child, in listing order', () => {
		expect(both_epics_tracking_the_child().get(CHILD)).toStrictEqual([OPTED_IN_EPIC, OTHER_EPIC])
	})

	it('leaves an issue no epic tracks unmapped', () => {
		expect(both_epics_tracking_the_child().has(UNTRACKED_CHILD)).toBe(false)
	})
})

describe('epic_index.build_epic_index', () => {
	it('keeps the last epic that names the child, which is what epic:bundle has always answered', () => {
		expect(epic_index.build_epic_index(COLLIDING_EPICS).get(CHILD)).toBe(OTHER_EPIC)
	})
})

describe('epic_index.withheld_children', () => {
	// The regression: the opted-in epic came first, so collapsing to one winner dropped it, the child
	// read as tracked by nobody who would offer it, and the standalone half offered it as well.
	it('withholds a child whose opted-in epic is not the one a collapsed index would keep', () => {
		const withheld = epic_index.withheld_children(both_epics_tracking_the_child(), [
			opted_in_epic_row(OPTED_IN_EPIC),
		])

		expect(withheld.get(CHILD)).toBe(OPTED_IN_EPIC)
	})

	it('withholds nothing when no epic tracking the child is opted in', () => {
		const withheld = epic_index.withheld_children(both_epics_tracking_the_child(), [])

		expect(withheld.has(CHILD)).toBe(false)
	})

	it('names the tracking epic when only one tracks the child', () => {
		const index = epic_index.build_tracking_index([{ number: OTHER_EPIC, body: CHILD_ROW }])
		const withheld = epic_index.withheld_children(index, [opted_in_epic_row(OTHER_EPIC)])

		expect(withheld.get(CHILD)).toBe(OTHER_EPIC)
	})
})
