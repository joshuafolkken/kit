import { describe, expect, it } from 'vitest'
import {
	BUG_LABEL,
	INTERRUPT_ROUTE_LABEL,
	PRIORITY_CRITICAL_LABEL,
	PRIORITY_HIGH_LABEL,
	RUN_SOLO_LABEL,
} from './issue-labels'
import { issue_priority } from './issue-priority'
import { issue_rank, type RankRow } from './issue-rank'

// joshuafolkken/kit#2928: priority:high, then a verification-path defect, then dependents, then the
// order the caller gave.

interface Row extends RankRow {
	name: string
}

function row(name: string, labels: ReadonlyArray<string> = [], dependents = 0): Row {
	return { name, labels, lost_minutes: 0, gain_minutes: 0, dependents }
}

function lost(name: string, lost_minutes: number, labels: ReadonlyArray<string> = []): Row {
	return { ...row(name, labels), lost_minutes }
}

function gained(name: string, gain_minutes: number): Row {
	return { ...row(name), gain_minutes }
}

function names_of(rows: ReadonlyArray<Row>): Array<string> {
	return issue_rank.rank(rows, (entry) => entry).map((entry) => entry.name)
}

const PLAIN = 'plain'
const URGENT = 'urgent'
const CRITICAL = 'critical'
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

// joshuafolkken/kit#4383: priority:critical is the key above priority:high.
describe('issue_rank.rank priority:critical', () => {
	it('puts priority:critical ahead of priority:high and a verification-path defect', () => {
		const rows = [
			row(URGENT, [PRIORITY_HIGH_LABEL]),
			row(DEFECT, [BUG_LABEL, RUN_SOLO_LABEL]),
			row(CRITICAL, [PRIORITY_CRITICAL_LABEL]),
		]

		expect(names_of(rows)).toStrictEqual([CRITICAL, URGENT, DEFECT])
	})
})

// joshuafolkken/kit#4859: within one priority, the larger declared causing lane goes first.
describe('issue_rank.rank lane minutes', () => {
	const LONG = 'long'
	const SHORT = 'short'
	const LONG_MINUTES = 16
	const SHORT_MINUTES = 4

	it('puts the larger causing lane ahead within one priority', () => {
		const rows = [
			lost(SHORT, SHORT_MINUTES, [PRIORITY_HIGH_LABEL]),
			lost(LONG, LONG_MINUTES, [PRIORITY_HIGH_LABEL]),
		]

		expect(names_of(rows)).toStrictEqual([LONG, SHORT])
	})

	it('puts an undeclared issue after every declared one of its priority, in the given order', () => {
		const rows = [row(PLAIN, [], MANY), lost(SHORT, SHORT_MINUTES), row(PLAIN_SECOND)]

		expect(names_of(rows)).toStrictEqual([SHORT, PLAIN, PLAIN_SECOND])
	})

	it('keeps a verification-path defect ahead of a larger causing lane', () => {
		const rows = [lost(LONG, LONG_MINUTES), row(DEFECT, [BUG_LABEL, RUN_SOLO_LABEL])]

		expect(names_of(rows)).toStrictEqual([DEFECT, LONG])
	})

	it('never lets the minutes reorder issues of different priorities', () => {
		const rows = [
			lost(LONG, LONG_MINUTES),
			lost(SHORT, SHORT_MINUTES, [PRIORITY_HIGH_LABEL]),
			row(CRITICAL, [PRIORITY_CRITICAL_LABEL]),
		]

		expect(names_of(rows)).toStrictEqual([CRITICAL, SHORT, LONG])
	})
})

// joshuafolkken/kit#4928: a recurrence appends a cause-loss line, so a cause that recurs ranks by its
// accumulated minutes, ahead of one larger in a single lane.
function cause_body(lines: ReadonlyArray<number>): string {
	const losses = lines.map((minutes) => `- 原因の損失: ${String(minutes)} 分\n`).join('')

	return `## 背景\n\n- 原因のレーン: 77 分（#4887）\n${losses}`
}

function from_body(name: string, lines: ReadonlyArray<number>): Row {
	return lost(name, issue_priority.lost_minutes(cause_body(lines)))
}

describe('issue_rank.rank accumulated cause loss', () => {
	const RECURRING = 'recurring'
	const SINGLE = 'single'

	it('orders by the sum of every recurrence, not by the largest single loss', () => {
		const rows = [from_body(SINGLE, [20]), from_body(RECURRING, [8, 7, 6])]

		expect(names_of(rows)).toStrictEqual([RECURRING, SINGLE])
	})
})

// joshuafolkken/kit#5302: a declared weekly speed-up is the key after the cause loss and before the
// dependents, so a measured time-saver runs ahead of an unmeasured feature of its priority.
describe('issue_rank.rank weekly gain', () => {
	const SAVER = 'saver'
	const BIG_SAVER = 'big-saver'
	const GAIN_MINUTES = 20.8
	const BIG_GAIN_MINUTES = 60
	const LOST_MINUTES = 5

	it('puts the declared speed-up ahead of undeclared issues, the larger gain first', () => {
		const rows = [
			row(PLAIN),
			gained(SAVER, GAIN_MINUTES),
			row(PLAIN_SECOND),
			gained(BIG_SAVER, BIG_GAIN_MINUTES),
		]

		expect(names_of(rows)).toStrictEqual([BIG_SAVER, SAVER, PLAIN, PLAIN_SECOND])
	})

	it('keeps a declared cause loss ahead of the gain, and the gain ahead of the dependents', () => {
		const rows = [row(WAITED_ON, [], MANY), gained(SAVER, GAIN_MINUTES), lost(DEFECT, LOST_MINUTES)]

		expect(names_of(rows)).toStrictEqual([DEFECT, SAVER, WAITED_ON])
	})

	it('never lets the gain lift an issue over a higher priority', () => {
		const rows = [gained(BIG_SAVER, BIG_GAIN_MINUTES), row(URGENT, [PRIORITY_HIGH_LABEL])]

		expect(names_of(rows)).toStrictEqual([URGENT, BIG_SAVER])
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
