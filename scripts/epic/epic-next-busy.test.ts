import { auto_ok_fixture, CREATED_EARLIER } from '#scripts/auto-ok/auto-ok-fixture'
import {
	capped_listing_outcome,
	listing_of,
	listing_outcome,
} from '#scripts/git/git-gh-issue-list-fixture'
import { IN_PROGRESS_LABEL, NEEDS_DECISION_LABEL } from '#scripts/git/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EpicSnapshot } from './epic-fetch'
import type { EpicChild } from './epic-graph'
import { epic_next } from './epic-next'
import type { EpicView } from './epic-next-views'
import { epic_view_fixture } from './epic-view-fixture'

// joshuafolkken/kit#925: `epic:next --repo` used to answer from the epic's own children alone, so an
// `in-progress` issue belonging to a *different* epic was invisible. Two `epicrun`s in one checkout
// then both answered "nothing of mine is in progress", and two children ran in the same working
// tree — destruction rather than interleaving. The invariant is per *repository*.
//
// joshuafolkken/kit#1491 made that invariant a count rather than a yes/no: an `in-progress` issue
// occupies one lane, and a repository offers children until its lanes are full. The one-lane case is
// exactly the old behavior, which is why the tests written for it pass `ONE_LANE` and still assert
// what they asserted before.

// `issue_blocked_by_references` is here because `epic:next --repo` confirms the candidate it is about
// to offer against its own relations listing (joshuafolkken/kit#1121). Left out, every candidate is
// withheld — which is the guard's safe direction working, and would make each test below assert the
// confirmation's failure rather than the exclusion it is about.
vi.mock('#scripts/git/git-gh-command', () => ({
	git_gh_command: {
		issue_list_by_label_in_repo: vi.fn(),
		issue_blocked_by_references: vi.fn(async () => []),
	},
}))

const { git_gh_command } = await import('#scripts/git/git-gh-command')
const issue_list = vi.mocked(git_gh_command.issue_list_by_label_in_repo)

const { issue, record } = auto_ok_fixture

const REPO = 'joshuafolkken/kit'
const EPIC_NUMBER = 858
const FIRST_CHILD = 861
const SECOND_CHILD = 862
// An issue this epic does not track at all — the case the classification cannot see.
const FOREIGN_HOLDER = 700
const THIRD_CHILD = 863
const SUCCESS_EXIT_CODE = 0
const ONE_LANE = 1
const TWO_LANES = 2
const WAIT_TOKEN = 'wait'
// The half of every not-idle explanation that says the guard did not fall open.
const NOT_IDLE = 'not "nothing is running"'

function child(number: number, labels: ReadonlyArray<string> = []): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels, blocked_by: [] }
}

function snapshot(children: ReadonlyArray<EpicChild>): EpicSnapshot {
	return {
		body: undefined,
		repo: REPO,
		current_repo: REPO,
		children,
		child_numbers: children.map((entry) => entry.number),
		unreadable: [],
		skipped: [],
		has_external_children: false,
	}
}

const stdout_lines: Array<string> = []
const stderr_lines: Array<string> = []

vi.spyOn(console, 'info').mockImplementation(record(stdout_lines))
vi.spyOn(console, 'error').mockImplementation(record(stderr_lines))

function stdout(): string {
	return stdout_lines.join('\n')
}

function stderr(): string {
	return stderr_lines.join('\n')
}

function views_of(children: ReadonlyArray<EpicChild>): Array<EpicView> {
	return epic_view_fixture.single_view(snapshot(children), EPIC_NUMBER)
}

// One `--repo` answer, end to end: classify the children, then ask the repository how many of its
// lanes are already running something.
//
// The limit defaults to one lane, which is what every assertion written before
// joshuafolkken/kit#1491 assumed — the old repository-wide exclusion is exactly the one-lane case,
// so those tests keep asserting the behavior they were written for.
async function answer_for(
	children: ReadonlyArray<EpicChild>,
	limit: number = ONE_LANE,
	is_all_lanes = false,
): Promise<number> {
	return await epic_next.report(views_of(children), { repo: REPO, limit, is_all_lanes })
}

function listing(numbers: ReadonlyArray<number>): string {
	return JSON.stringify(
		numbers.map((number) => issue(number, CREATED_EARLIER, [IN_PROGRESS_LABEL])),
	)
}

beforeEach(() => {
	vi.clearAllMocks()
	stdout_lines.length = 0
	stderr_lines.length = 0
})

describe('josh epic:next --repo — a repository that is already running something', () => {
	it('offers the child when nothing is in progress there', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome('[]'))

		expect(await answer_for([child(FIRST_CHILD)])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(FIRST_CHILD))
	})

	// The whole point: the holder is not tracked by this epic, so no classification of *its* children
	// could ever have seen it.
	it('waits on an in-progress issue this epic does not track', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome(listing([FOREIGN_HOLDER])))

		expect(await answer_for([child(FIRST_CHILD)])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(WAIT_TOKEN)
	})

	// Named because the stale-label rule is applied by whoever finds the label stale, and a run told
	// only "wait" has nothing to go and look at.
	it('names the issue that holds the repository', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome(listing([FOREIGN_HOLDER])))

		await answer_for([child(FIRST_CHILD)])

		expect(stderr()).toContain(`#${String(FOREIGN_HOLDER)}`)
	})

	// The stale path: removing an abandoned `in-progress` label empties the listing, and the same
	// epic is offered its child on the next ask. Without this the guard could wait forever.
	it('offers the child again once a stale label has been removed', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome(listing([FOREIGN_HOLDER])))
		await answer_for([child(FIRST_CHILD)])

		stdout_lines.length = 0
		issue_list.mockResolvedValueOnce(listing_outcome('[]'))

		expect(await answer_for([child(FIRST_CHILD)])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(FIRST_CHILD))
	})

	// A read that failed is not an idle repository: reading it as one starts the second child this
	// guard exists to prevent. It is not an error either — `issue_list_open` swallows a passing rate
	// limit into the same `undefined`, and ending an unattended run over a blip is what `wait` avoids.
	it('waits rather than offering a child when the listing could not be read', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome(undefined))

		expect(await answer_for([child(FIRST_CHILD)])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(WAIT_TOKEN)
	})

	it('says why it is waiting when the listing could not be read', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome(undefined))

		await answer_for([child(FIRST_CHILD)])

		expect(stderr()).toContain(NOT_IDLE)
	})
})

describe('josh epic:next --repo — an in-progress child of this epic', () => {
	// The existing behavior, unchanged: a child carrying `in-progress` is classified as waiting on
	// time, before any blocker is consulted (joshuafolkken/kit#860).
	it('still classifies it as waiting on time', () => {
		const state = snapshot([child(FIRST_CHILD, [IN_PROGRESS_LABEL])])
		const result = epic_next.decide(state)

		expect(result.verdict).toBe(WAIT_TOKEN)
		expect(result.waiting.map((entry) => entry.number)).toEqual([FIRST_CHILD])
		expect(result.candidates).toEqual([])
	})

	it('answers wait without asking the repository anything', async () => {
		expect(await answer_for([child(FIRST_CHILD, [IN_PROGRESS_LABEL])])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(WAIT_TOKEN)
		expect(issue_list).not.toHaveBeenCalled()
	})

	// A sibling is runnable by the classification, and the repository is busy — the invariant is one
	// child per repository, so the sibling waits too.
	it('holds a runnable sibling back while it runs', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome(listing([FIRST_CHILD])))

		const children = [child(FIRST_CHILD, [IN_PROGRESS_LABEL]), child(SECOND_CHILD)]

		expect(await answer_for(children)).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(WAIT_TOKEN)
	})
})

describe('josh epic:next --repo — a parked child', () => {
	// `park and continue` is the property `epicrun` exists for, and nothing removes `in-progress`
	// when a child is parked — so a guard that counted the parked child as a holder would stop the
	// run it was meant to keep going.
	it('offers a sibling rather than waiting on the child it just set aside', async () => {
		issue_list.mockResolvedValueOnce(
			listing_of([issue(FIRST_CHILD, CREATED_EARLIER, [IN_PROGRESS_LABEL, NEEDS_DECISION_LABEL])]),
		)

		const children = [
			child(FIRST_CHILD, [IN_PROGRESS_LABEL, NEEDS_DECISION_LABEL]),
			child(SECOND_CHILD),
		]

		expect(await answer_for(children)).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(SECOND_CHILD))
	})
})

describe('josh epic:next --repo — verdicts that start nothing', () => {
	// Consulted on `complete` as well, an unrelated `in-progress` issue would turn a finished epic
	// into a permanent `wait` — a guard outliving the thing it guards.
	it('reports a finished epic without asking the repository', async () => {
		const closed: EpicChild = { ...child(FIRST_CHILD), state: 'CLOSED' }

		expect(await answer_for([closed])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe('complete')
		expect(issue_list).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#925: `--repo` is what asks a repository whether it is busy, so the aggregate
// listing can name a child the `--repo` form would answer `wait` for. Said out loud rather than left
// for a reader to discover.
describe('josh epic:next without --repo', () => {
	it('says the per-repository exclusion was not consulted', async () => {
		await epic_next.report(views_of([child(FIRST_CHILD)]), undefined)

		expect(stderr()).toContain(epic_next.UNCHECKED_EXCLUSION)
		expect(issue_list).not.toHaveBeenCalled()
	})

	it('says nothing of the kind when there is no runnable child', async () => {
		await epic_next.report(views_of([child(FIRST_CHILD, [IN_PROGRESS_LABEL])]), undefined)

		expect(stderr()).not.toContain(epic_next.UNCHECKED_EXCLUSION)
	})
})

// joshuafolkken/kit#1067: the page ceiling bounds this listing too now, and a short listing with no
// visible holder must land where an unreadable one lands. The direction is the one kit#925 closed —
// reading "I did not see everything" as "nothing is running" starts a second child in one checkout.
describe('josh epic:next --repo — a listing that was cut short', () => {
	it('waits rather than offering a child when the listing was truncated', async () => {
		issue_list.mockResolvedValueOnce(capped_listing_outcome('[]'))

		expect(await answer_for([child(FIRST_CHILD)])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(WAIT_TOKEN)
	})

	// The token is the whole contract: a loop reads `child=$(josh epic:next … --repo …)` and branches
	// on it, so the explanation goes to standard error and nothing else joins it on standard output.
	it('keeps the explanation off standard output', async () => {
		issue_list.mockResolvedValueOnce(capped_listing_outcome('[]'))

		await answer_for([child(FIRST_CHILD)])

		expect(stdout()).toBe(WAIT_TOKEN)
		expect(stderr()).toContain(NOT_IDLE)
	})

	// Removing the stale labels shortens the listing below the cut, and the same epic is offered its
	// child on the next ask — so the guard resolves the way the busy one does rather than latching.
	it('offers the child again once the listing fits', async () => {
		issue_list.mockResolvedValueOnce(capped_listing_outcome('[]'))
		await answer_for([child(FIRST_CHILD)])

		stdout_lines.length = 0
		issue_list.mockResolvedValueOnce(listing_outcome('[]'))

		expect(await answer_for([child(FIRST_CHILD)])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(FIRST_CHILD))
	})
})

// joshuafolkken/kit#1491: an `in-progress` issue occupies a lane rather than the whole repository, so
// a second child starts beside the first for as long as the limit has not been reached.
describe('josh epic:next --repo — lanes rather than a repository-wide exclusion', () => {
	it('offers a child while another lane is running, when one is still free', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome(listing([FOREIGN_HOLDER])))

		expect(await answer_for([child(FIRST_CHILD)], TWO_LANES)).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(FIRST_CHILD))
	})

	it('waits once every lane is in use', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome(listing([FOREIGN_HOLDER, THIRD_CHILD])))

		expect(await answer_for([child(FIRST_CHILD)], TWO_LANES)).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(WAIT_TOKEN)
	})

	// The occupancy is the number a person tunes the limit against, so it is said rather than left to
	// be inferred from a bare `wait`.
	it('names how many lanes are in use when it refuses', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome(listing([FOREIGN_HOLDER, THIRD_CHILD])))

		await answer_for([child(FIRST_CHILD)], TWO_LANES)

		expect(stderr()).toContain('2 of 2 lanes in use')
	})

	// The count comes from the repository's own `in-progress` listing, never from anything this
	// session remembers — which is what stops two sessions each counting to the limit on their own.
	it('counts the lanes from the in-progress listing', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome(listing([FOREIGN_HOLDER])))

		await answer_for([child(FIRST_CHILD)], TWO_LANES)

		expect(issue_list).toHaveBeenCalledWith(IN_PROGRESS_LABEL, expect.any(Number), REPO)
	})
})

// `--lanes` is what asks for more than one child. Without it the answer is a single token, so
// `child=$(josh epic:next … --repo …)` reads exactly what it always read (joshuafolkken/kit#1491).
describe('josh epic:next --repo --lanes', () => {
	it('offers one child per free lane', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome('[]'))

		const children = [child(FIRST_CHILD), child(SECOND_CHILD), child(THIRD_CHILD)]

		expect(await answer_for(children, TWO_LANES, true)).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(`${String(FIRST_CHILD)}\n${String(SECOND_CHILD)}`)
	})

	it('offers a single child without the flag, however many lanes are free', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome('[]'))

		const children = [child(FIRST_CHILD), child(SECOND_CHILD), child(THIRD_CHILD)]

		expect(await answer_for(children, TWO_LANES)).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(FIRST_CHILD))
	})
})
