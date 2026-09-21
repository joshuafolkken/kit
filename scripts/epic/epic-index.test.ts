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

// A root's `auto-ok` opts in every epic under it, however deep — the transitive closure
// joshuafolkken/kit#2244 opens up over the one-level reading of joshuafolkken/kit#1668.
const ROOT_EPIC = 900
const NESTED_EPIC = 910
const DEEPER_EPIC = 920
const GRANDCHILD = 44
const PEER_ROOT = 930

const { issue } = auto_ok_fixture

// A row of the opted-in listing that is itself an epic — the shape `opted_in_epic_numbers` reads.
function opted_in_epic_row(number: number): OpenIssueData {
	return issue(number, CREATED_AT, [AUTO_OK_LABEL, EPIC_LABEL])
}

function task_row(number: number): string {
	return `- [ ] #${String(number)}`
}

// A tracking index built from `[epic, child]` pairs, each epic's body naming its one task-list child.
function tracking_of(
	pairs: ReadonlyArray<readonly [number, number]>,
): ReadonlyMap<number, ReadonlyArray<number>> {
	return epic_index.build_tracking_index(
		pairs.map(([epic, child]) => ({ number: epic, body: task_row(child) })),
	)
}

function sorted(numbers: Iterable<number>): Array<number> {
	return [...numbers].toSorted((left, right) => left - right)
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

	// The child of a nested epic is withheld from the standalone half once its epic is reachable from an
	// `auto-ok` root, or it would be offered both through the epic and standalone (joshuafolkken/kit#2244).
	it('withholds a grandchild through the nested epic that reaches it', () => {
		const index = tracking_of([
			[ROOT_EPIC, NESTED_EPIC],
			[NESTED_EPIC, GRANDCHILD],
		])
		const withheld = epic_index.withheld_children(index, [opted_in_epic_row(ROOT_EPIC)])

		expect(withheld.get(GRANDCHILD)).toBe(NESTED_EPIC)
	})
})

// Root → nested epic → deeper epic: every epic on the chain is reached, so the deeper epic's own
// children (the grandchildren the issue is about) are read rather than dropped as "not opted in".
const THREE_LEVEL_CHAIN: ReadonlyArray<readonly [number, number]> = [
	[ROOT_EPIC, NESTED_EPIC],
	[NESTED_EPIC, DEEPER_EPIC],
	[DEEPER_EPIC, GRANDCHILD],
]

describe('epic_index.reachable_epic_numbers', () => {
	it('reaches a nested epic three levels below an auto-ok root', () => {
		const reached = epic_index.reachable_epic_numbers(tracking_of(THREE_LEVEL_CHAIN), [
			opted_in_epic_row(ROOT_EPIC),
		])

		expect(sorted(reached)).toStrictEqual([ROOT_EPIC, NESTED_EPIC, DEEPER_EPIC])
	})

	// A root that carries no `auto-ok` is not in the opted-in listing, so nothing under it is reached —
	// the #1668 behavior this change must not break.
	it('reaches nothing under a root that is not opted in', () => {
		const reached = epic_index.reachable_epic_numbers(tracking_of(THREE_LEVEL_CHAIN), [])

		expect(reached.size).toBe(0)
	})

	// Two epics that list each other cannot loop the walk: the visited set makes the second visit a
	// no-op, so the closure is the two of them and it terminates.
	it('terminates on a cycle and returns each epic once', () => {
		const cycle = tracking_of([
			[ROOT_EPIC, NESTED_EPIC],
			[NESTED_EPIC, ROOT_EPIC],
		])
		const reached = epic_index.reachable_epic_numbers(cycle, [opted_in_epic_row(ROOT_EPIC)])

		expect(sorted(reached)).toStrictEqual([ROOT_EPIC, NESTED_EPIC])
	})

	// Two opted-in roots reaching the same nested epic add it once, not twice — the set is the dedup.
	it('reaches a shared nested epic once from two roots', () => {
		const shared = tracking_of([
			[ROOT_EPIC, NESTED_EPIC],
			[PEER_ROOT, NESTED_EPIC],
			[NESTED_EPIC, GRANDCHILD],
		])
		const reached = epic_index.reachable_epic_numbers(shared, [
			opted_in_epic_row(ROOT_EPIC),
			opted_in_epic_row(PEER_ROOT),
		])

		expect([...reached].filter((number) => number === NESTED_EPIC)).toStrictEqual([NESTED_EPIC])
	})
})
