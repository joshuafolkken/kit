import { NEEDS_DECISION_LABEL } from '#scripts/git/issue-labels'
import { describe, expect, it, vi } from 'vitest'
import type { EpicSnapshot } from './epic-fetch'
import type { EpicChild, IssueReference } from './epic-graph'
import { epic_next } from './epic-next'
import type { EpicRead } from './epic-next-read'
import type { EpicView } from './epic-next-views'
import type { EpicNextResult } from './epic-report'

// joshuafolkken/kit#1943: `epic:next` over several epics weighs a blocker in another named epic as
// something the run will finish, and a blocker in no named epic as something only a person can release.

const REPO = 'joshuafolkken/kit'
const FIRST_EPIC = 100
const SECOND_EPIC = 200
const WAITING_CHILD = 1
const OTHER_EPIC_CHILD = 5
const UNNAMED_BLOCKER = 7

function open_blocker(number: number): IssueReference {
	return { repo: REPO, number, state: 'OPEN' }
}

function child(
	number: number,
	blocked_by: ReadonlyArray<IssueReference> = [],
	labels: ReadonlyArray<string> = [],
): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels, blocked_by }
}

function read(epic: number, children: ReadonlyArray<EpicChild>): EpicRead {
	const snapshot: EpicSnapshot = {
		body: undefined,
		repo: REPO,
		current_repo: REPO,
		children,
		child_numbers: children.map((entry) => entry.number),
		unreadable: [],
		skipped: [],
		has_external_children: false,
		body_failure: undefined,
		is_unreachable: false,
	}

	return { reference: { number: epic }, snapshot }
}

function numbers(children: ReadonlyArray<EpicChild> | undefined): Array<number> {
	return (children ?? []).map((entry) => entry.number)
}

function views_of(first: EpicChild, second: EpicChild): ReadonlyArray<EpicView> {
	return epic_next.views_of([read(FIRST_EPIC, [first]), read(SECOND_EPIC, [second])])
}

function result_of(views: ReadonlyArray<EpicView>, index: number): EpicNextResult | undefined {
	return views[index]?.result
}

describe('epic_next.views_of — blockers across the named epics', () => {
	it('waits on a blocker another named epic tracks', () => {
		const views = views_of(
			child(WAITING_CHILD, [open_blocker(OTHER_EPIC_CHILD)]),
			child(OTHER_EPIC_CHILD),
		)
		const offered = result_of(views, 1)?.candidates[0]?.children

		expect(numbers(result_of(views, 0)?.waiting)).toEqual([WAITING_CHILD])
		expect(numbers(offered)).toEqual([OTHER_EPIC_CHILD])
	})

	it('goes to a person for a blocker no named epic tracks', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		const views = views_of(
			child(WAITING_CHILD, [open_blocker(UNNAMED_BLOCKER)]),
			child(OTHER_EPIC_CHILD),
		)

		expect(numbers(result_of(views, 0)?.blocked_on_people)).toEqual([WAITING_CHILD])
		warn.mockRestore()
	})

	it('carries the running set on each view for the candidate confirmation', () => {
		const views = views_of(child(WAITING_CHILD), child(OTHER_EPIC_CHILD))

		expect(views[0]?.running?.has(`${REPO}#${String(OTHER_EPIC_CHILD)}`)).toBe(true)
	})

	// A blocker the run tracks but cannot finish without a person holds its dependant for that person,
	// exactly as a parked blocker inside one epic does.
	it('goes to a person for a blocker another named epic tracks but has parked', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		const views = views_of(
			child(WAITING_CHILD, [open_blocker(OTHER_EPIC_CHILD)]),
			child(OTHER_EPIC_CHILD, [], [NEEDS_DECISION_LABEL]),
		)

		expect(numbers(result_of(views, 0)?.blocked_on_people)).toEqual([WAITING_CHILD])
		warn.mockRestore()
	})
})
