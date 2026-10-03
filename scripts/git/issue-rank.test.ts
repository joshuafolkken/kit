import { describe, expect, it } from 'vitest'
import {
	BUG_LABEL,
	INTERRUPT_ROUTE_LABEL,
	PRIORITY_HIGH_LABEL,
	RUN_SOLO_LABEL,
} from './issue-labels'
import { issue_rank, type RankRow } from './issue-rank'

// joshuafolkken/kit#2928: priority:high, then a verification-path defect, then dependents, then the
// order the caller gave.

interface Row extends RankRow {
	name: string
}

function row(name: string, labels: ReadonlyArray<string> = [], dependents = 0): Row {
	return { name, labels, dependents }
}

function names_of(rows: ReadonlyArray<Row>): Array<string> {
	return issue_rank.rank(rows, (entry) => entry).map((entry) => entry.name)
}

const PLAIN = 'plain'
const URGENT = 'urgent'
const DEFECT = 'defect'
const WAITED_ON = 'waited-on'
const PLAIN_SECOND = 'plain-second'
const MANY = 3
const FEW = 1

describe('issue_rank.rank', () => {
	it('orders priority:high, verification-path defect, dependents, then the given order', () => {
		const rows = [
			row(PLAIN),
			row(WAITED_ON, [], MANY),
			row(DEFECT, [BUG_LABEL, RUN_SOLO_LABEL]),
			row(URGENT, [PRIORITY_HIGH_LABEL]),
			row(PLAIN_SECOND),
		]

		expect(names_of(rows)).toStrictEqual([URGENT, DEFECT, WAITED_ON, PLAIN, PLAIN_SECOND])
	})

	it('puts more dependents ahead of fewer', () => {
		expect(names_of([row('few', [], FEW), row('many', [], MANY)])).toStrictEqual(['many', 'few'])
	})

	it('counts route:interrupt as a verification-path defect', () => {
		expect(names_of([row(PLAIN), row('interrupt', [INTERRUPT_ROUTE_LABEL])])).toStrictEqual([
			'interrupt',
			PLAIN,
		])
	})

	it('does not lift run:solo without bug, nor bug without run:solo', () => {
		const rows = [row(PLAIN), row('solo', [RUN_SOLO_LABEL]), row('bug', [BUG_LABEL])]

		expect(names_of(rows)).toStrictEqual([PLAIN, 'solo', 'bug'])
	})

	it('matches the labels case-insensitively', () => {
		expect(names_of([row(PLAIN), row(URGENT, ['Priority:High'])])).toStrictEqual([URGENT, PLAIN])
	})
})

describe('issue_rank.count_dependents', () => {
	it('counts each row that waits on a key once', () => {
		const counts = issue_rank.count_dependents([
			{ key: 'a', blockers: [] },
			{ key: 'b', blockers: ['a', 'a'] },
			{ key: 'c', blockers: ['a', 'b'] },
		])

		expect(counts.get('a')).toBe(2)
		expect(counts.get('b')).toBe(1)
		expect(counts.get('c')).toBeUndefined()
	})
})
