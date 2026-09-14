import { describe, expect, it } from 'vitest'
import { backlog_named, type NamedItem } from './backlog-named'

// joshuafolkken/kit#1984: `backlogrun #N1 #N2 …` runs the named issues in order and then drains the
// opted-in backlog, folding in what `queue` used to be a separate keyword for. joshuafolkken/kit#1985:
// a named item may itself be an epic, whose children run to completion before the next item, folding in
// what `epicrun` used to be a separate keyword for. These pin the decisions the folded procedure rests
// on — the execution order, what a failure partway through the named list does, and how an epic item
// completes — so the plan and the loop cannot drift from each other.

function single(issue: number): NamedItem {
	return { issue, is_epic: false }
}

function epic(issue: number): NamedItem {
	return { issue, is_epic: true }
}

const NAMED = [single(1762), single(1749), single(1759)]

describe('the execution plan', () => {
	it('runs the named issues in order, then the backlog', () => {
		expect(backlog_named.plan(NAMED)).toStrictEqual([
			{ kind: 'named', issue: 1762, is_epic: false },
			{ kind: 'named', issue: 1749, is_epic: false },
			{ kind: 'named', issue: 1759, is_epic: false },
			{ kind: 'backlog' },
		])
	})

	// A bare `backlogrun` names nothing, so its plan is the backlog alone — the behavior it always had.
	it('is the backlog alone when no issue is named', () => {
		expect(backlog_named.plan([])).toStrictEqual([{ kind: 'backlog' }])
	})

	// `--only` runs the named issues and stops, so the backlog step is dropped.
	it('omits the backlog when --only is set', () => {
		expect(backlog_named.plan(NAMED, true)).toStrictEqual([
			{ kind: 'named', issue: 1762, is_epic: false },
			{ kind: 'named', issue: 1749, is_epic: false },
			{ kind: 'named', issue: 1759, is_epic: false },
		])
	})

	// An epic item is one step that carries `is_epic`, so the loop runs its whole graph before the next
	// item — the next named item does not start until the epic item is complete (joshuafolkken/kit#1985).
	it('marks an epic item so it runs to completion before the next item', () => {
		expect(backlog_named.plan([epic(858), single(900)])).toStrictEqual([
			{ kind: 'named', issue: 858, is_epic: true },
			{ kind: 'named', issue: 900, is_epic: false },
			{ kind: 'backlog' },
		])
	})
})

describe('the startup decision without --only', () => {
	it('is the plan when issues are named', () => {
		expect(backlog_named.startup(NAMED)).toStrictEqual({
			kind: 'plan',
			steps: backlog_named.plan(NAMED),
		})
	})

	// A bare `backlogrun` is still a valid start — the plan is the backlog alone.
	it('is the backlog-alone plan when nothing is named', () => {
		expect(backlog_named.startup([])).toStrictEqual({
			kind: 'plan',
			steps: [{ kind: 'backlog' }],
		})
	})
})

describe('the startup decision under --only', () => {
	// `--only` with no named issues has nothing to run, so it is refused before anything starts.
	it('refuses --only with no named issues', () => {
		expect(backlog_named.startup([], true)).toStrictEqual({
			kind: 'refused',
			reason: backlog_named.NOTHING_TO_RUN,
		})
	})

	it('is the named-only plan when --only names issues', () => {
		expect(backlog_named.startup(NAMED, true)).toStrictEqual({
			kind: 'plan',
			steps: backlog_named.plan(NAMED, true),
		})
	})

	// `backlogrun #E --only` runs the epic's children and stops — no backlog step follows, which is the
	// old `epicrun #E`'s scope under one keyword (joshuafolkken/kit#1985).
	it('runs an epic item and stops, draining no pool', () => {
		expect(backlog_named.startup([epic(858)], true)).toStrictEqual({
			kind: 'plan',
			steps: [{ kind: 'named', issue: 858, is_epic: true }],
		})
	})
})

describe('a named issue failing partway through', () => {
	// The order was the point of naming them, so the issues declared after the failure are not started.
	it('parks the failure, skips the rest of the named list, and proceeds to the backlog', () => {
		expect(backlog_named.after_failure(NAMED, 1749)).toStrictEqual({
			parked: 1749,
			skipped: [1759],
			next: 'backlog',
		})
	})

	it('skips nothing when the last named issue is the one that failed', () => {
		expect(backlog_named.after_failure(NAMED, 1759)).toStrictEqual({
			parked: 1759,
			skipped: [],
			next: 'backlog',
		})
	})

	it('skips the whole remaining list when the first named issue failed', () => {
		expect(backlog_named.after_failure(NAMED, 1762)).toStrictEqual({
			parked: 1762,
			skipped: [1749, 1759],
			next: 'backlog',
		})
	})

	// A failure of an issue outside the named list — a backlog child — skips nothing.
	it('skips nothing for an issue that was not named', () => {
		expect(backlog_named.after_failure(NAMED, 9999)).toStrictEqual({
			parked: 9999,
			skipped: [],
			next: 'backlog',
		})
	})
})

describe('a named issue failing under --only', () => {
	// Under `--only` there is no pool to fall through to, so the run ends after skipping the rest.
	it('ends rather than proceeding to the backlog', () => {
		expect(backlog_named.after_failure(NAMED, 1749, true)).toStrictEqual({
			parked: 1749,
			skipped: [1759],
			next: 'end',
		})
	})
})

describe('an epic named item completes rather than parking as a unit', () => {
	const NAMED_WITH_EPIC = [single(1762), epic(858), single(1759)]

	// An epic item's parked child is never in the named list, so it skips nothing — the run advances to
	// the item declared after the epic (joshuafolkken/kit#1985).
	it('skips nothing when a child of the epic item parks', () => {
		expect(backlog_named.after_failure(NAMED_WITH_EPIC, 5001)).toStrictEqual({
			parked: 5001,
			skipped: [],
			next: 'backlog',
		})
	})

	// Even if the epic item's own number surfaces as a failure, it does not skip the list: an epic item
	// completes through `epic_item_outcome`, so the item after it still runs.
	it('does not skip the list on the epic item number itself', () => {
		expect(backlog_named.after_failure(NAMED_WITH_EPIC, 858)).toStrictEqual({
			parked: 858,
			skipped: [],
			next: 'backlog',
		})
	})

	// The epic item is complete once every child is processed; the parked children are carried out so the
	// completion report can list them, and the run advances regardless (joshuafolkken/kit#1985).
	it('completes and carries the parked children to the report', () => {
		expect(
			backlog_named.epic_item_outcome(858, [
				{ issue: 5001, parked: false },
				{ issue: 5002, parked: true },
				{ issue: 5003, parked: true },
			]),
		).toStrictEqual({ epic: 858, parked: [5002, 5003], complete: true })
	})

	it('completes with an empty parked list when every child merged', () => {
		expect(
			backlog_named.epic_item_outcome(858, [
				{ issue: 5001, parked: false },
				{ issue: 5002, parked: false },
			]),
		).toStrictEqual({ epic: 858, parked: [], complete: true })
	})
})
