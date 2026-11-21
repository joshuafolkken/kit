import { describe, expect, it } from 'vitest'
import { PRIORITY_CRITICAL_LABEL, PRIORITY_HIGH_LABEL } from './issue-labels'
import { issue_rank, type DependencyRow } from './issue-rank'

// joshuafolkken/kit#8541: an issue blocking an open issue of the pool ranks in the highest priority
// class of the issues it blocks, transitively, whatever its own labels. The labels are not rewritten.

const PLAIN = 'plain'
const URGENT = 'urgent'
const OTHER_URGENT = 'other-urgent'
const CRITICAL = 'critical'
const BLOCKER = 'blocker'
const UPSTREAM = 'upstream'

function dependency(
	key: string,
	blockers: ReadonlyArray<string>,
	labels: ReadonlyArray<string> = [],
): DependencyRow {
	return { key, labels, blockers }
}

function ranked_pool(rows: ReadonlyArray<DependencyRow>): Array<string> {
	const rank_of = issue_rank.dependency_ranks(rows)

	return issue_rank
		.rank(rows, (entry) => ({
			is_defect: false,
			is_last: false,
			labels: entry.labels,
			lost_minutes: 0,
			gain_minutes: 0,
			...rank_of(entry.key),
		}))
		.map((entry) => entry.key)
}

describe('issue_rank.rank blocked priority class', () => {
	it('ranks an unlabelled blocker of a priority:high issue in the high class (ac-b3357c49)', () => {
		const rows = [
			dependency(PLAIN, []),
			dependency(OTHER_URGENT, [], [PRIORITY_HIGH_LABEL]),
			dependency(URGENT, [BLOCKER], [PRIORITY_HIGH_LABEL]),
			dependency(BLOCKER, []),
		]

		expect(ranked_pool(rows)).toStrictEqual([BLOCKER, OTHER_URGENT, URGENT, PLAIN])
	})

	it('ranks a blocker of a priority:critical issue in the critical class (ac-96f1214f)', () => {
		const rows = [
			dependency(URGENT, [], [PRIORITY_HIGH_LABEL]),
			dependency(CRITICAL, [BLOCKER], [PRIORITY_CRITICAL_LABEL]),
			dependency(BLOCKER, []),
		]

		expect(ranked_pool(rows)).toStrictEqual([BLOCKER, CRITICAL, URGENT])
	})

	it('lifts a transitive blocker (high ← A ← B) into the high class (ac-0f5dbc35)', () => {
		const rows = [
			dependency(PLAIN, []),
			dependency(OTHER_URGENT, [], [PRIORITY_HIGH_LABEL]),
			dependency(URGENT, [BLOCKER], [PRIORITY_HIGH_LABEL]),
			dependency(BLOCKER, [UPSTREAM]),
			dependency(UPSTREAM, []),
		]

		expect(ranked_pool(rows)).toStrictEqual([UPSTREAM, BLOCKER, OTHER_URGENT, URGENT, PLAIN])
	})

	it('does not lift a blocker whose blocked issue is not a row of the pool (ac-a55d5ed8)', () => {
		const rows = [dependency(PLAIN, []), dependency(BLOCKER, [])]

		expect(issue_rank.blocked_priorities(rows).get(BLOCKER)).toBeUndefined()
		expect(ranked_pool(rows)).toStrictEqual([PLAIN, BLOCKER])
	})
})

describe('issue_rank.blocked_priorities', () => {
	it('leaves the input labels unchanged (ac-a0f5a8b4)', () => {
		const rows = [dependency(URGENT, [BLOCKER], [PRIORITY_HIGH_LABEL]), dependency(BLOCKER, [])]

		ranked_pool(rows)

		expect(rows.map((entry) => entry.labels)).toStrictEqual([[PRIORITY_HIGH_LABEL], []])
	})

	it('stops on a cycle, taking the class of the other side', () => {
		const priorities = issue_rank.blocked_priorities([
			dependency('a', ['b'], [PRIORITY_HIGH_LABEL]),
			dependency('b', ['a']),
		])

		expect(priorities.get('a')).toBe(0)
		expect(priorities.get('b')).toBe(1)
	})
})
