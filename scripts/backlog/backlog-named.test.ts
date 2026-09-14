import { describe, expect, it } from 'vitest'
import { backlog_named } from './backlog-named'

// joshuafolkken/kit#1984: `backlogrun #N1 #N2 …` runs the named issues in order and then drains the
// opted-in backlog, folding in what `queue` used to be a separate keyword for. These pin the two
// decisions the folded procedure rests on — the execution order, and what a failure partway through
// the named list does — so the plan and the loop cannot drift from each other.

const NAMED = [1762, 1749, 1759]

describe('the execution plan', () => {
	it('runs the named issues in order, then the backlog', () => {
		expect(backlog_named.plan(NAMED)).toStrictEqual([
			{ kind: 'named', issue: 1762 },
			{ kind: 'named', issue: 1749 },
			{ kind: 'named', issue: 1759 },
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
			{ kind: 'named', issue: 1762 },
			{ kind: 'named', issue: 1749 },
			{ kind: 'named', issue: 1759 },
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
