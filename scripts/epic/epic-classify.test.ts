import { IN_PROGRESS_LABEL, NEEDS_DECISION_LABEL } from '#scripts/git/issue-labels'
import { describe, expect, it } from 'vitest'
import { epic_classify, type DependencyVerdict } from './epic-classify'
import type { EpicChild } from './epic-graph'

const REPO = 'joshuafolkken/kit'

interface ChildOptions {
	state?: 'OPEN' | 'CLOSED'
	labels?: ReadonlyArray<string>
	blocked_by?: ReadonlyArray<number>
	repo?: string
}

const CHILD_DEFAULTS = { repo: REPO, state: 'OPEN', labels: [], blocked_by: [] } as const

function child(number: number, options: ChildOptions = {}): EpicChild {
	return { ...CHILD_DEFAULTS, ...options, number }
}

function numbers(children: ReadonlyArray<EpicChild>): Array<number> {
	return children.map((entry) => entry.number)
}

describe('epic_classify.classify_children — the plain cases', () => {
	it('offers an unblocked open child', () => {
		const result = epic_classify.classify_children([child(1)])

		expect(numbers(result.runnable)).toEqual([1])
	})

	it('leaves closed children out of every bucket', () => {
		const result = epic_classify.classify_children([child(1, { state: 'CLOSED' })])

		expect(result.runnable).toEqual([])
		expect(result.time).toEqual([])
		expect(result.human).toEqual([])
	})

	it('excludes a child whose blocker is still open', () => {
		const result = epic_classify.classify_children([child(1), child(2, { blocked_by: [1] })])

		expect(numbers(result.runnable)).toEqual([1])
		expect(numbers(result.time)).toEqual([2])
	})

	it('offers a child once its blocker is closed', () => {
		const children = [child(1, { state: 'CLOSED' }), child(2, { blocked_by: [1] })]

		expect(numbers(epic_classify.classify_children(children).runnable)).toEqual([2])
	})

	it('excludes a child already being worked on', () => {
		const result = epic_classify.classify_children([child(1, { labels: [IN_PROGRESS_LABEL] })])

		expect(result.runnable).toEqual([])
		expect(numbers(result.time)).toEqual([1])
	})

	it('excludes a parked child, and calls it a person problem', () => {
		const result = epic_classify.classify_children([child(1, { labels: [NEEDS_DECISION_LABEL] })])

		expect(result.runnable).toEqual([])
		expect(numbers(result.human)).toEqual([1])
	})
})

describe('epic_classify.classify_children — blocking is transitive', () => {
	it('puts a child behind a running one on the waiting side', () => {
		const children = [child(1, { labels: [IN_PROGRESS_LABEL] }), child(2, { blocked_by: [1] })]

		expect(numbers(epic_classify.classify_children(children).time)).toEqual([1, 2])
	})

	it('puts a child behind a parked one on the person side', () => {
		const children = [child(1, { labels: [NEEDS_DECISION_LABEL] }), child(2, { blocked_by: [1] })]

		expect(numbers(epic_classify.classify_children(children).human)).toEqual([1, 2])
	})

	it('carries a parked blocker through a chain', () => {
		const children = [
			child(1, { labels: [NEEDS_DECISION_LABEL] }),
			child(2, { blocked_by: [1] }),
			child(3, { blocked_by: [2] }),
		]

		expect(numbers(epic_classify.classify_children(children).human)).toEqual([1, 2, 3])
	})

	// Waiting would not release it: the parked blocker needs a person whatever the other one does.
	it('lets a person blocker win over a time blocker', () => {
		const children = [
			child(1, { labels: [NEEDS_DECISION_LABEL] }),
			child(2, { labels: [IN_PROGRESS_LABEL] }),
			child(3, { blocked_by: [1, 2] }),
		]

		expect(numbers(epic_classify.classify_children(children).human)).toContain(3)
	})
})

// The whole reason the categories are not read off labels: this is the state where a label-based
// reading sees "nothing running, nothing parked" and stops, in the one moment it should wait.
describe('epic_classify.classify_children — the extension point', () => {
	// joshuafolkken/kit#864's case: the blocker is closed, but its package is not published yet.
	const publish_pending: DependencyVerdict = 'time'

	it('waits when a resolver says a closed blocker is not finished yet', () => {
		const children = [child(1, { state: 'CLOSED' }), child(2, { blocked_by: [1] })]
		const result = epic_classify.classify_children(children, () => publish_pending)

		expect(result.runnable).toEqual([])
		expect(numbers(result.time)).toEqual([2])
	})

	it('reaches the same verdict through a chain behind the pending blocker', () => {
		const children = [
			child(1, { state: 'CLOSED' }),
			child(2, { blocked_by: [1] }),
			child(3, { blocked_by: [2] }),
		]
		const result = epic_classify.classify_children(children, () => publish_pending)

		expect(numbers(result.time)).toEqual([2, 3])
	})

	it('lets a resolver declare a dependency a person has to release', () => {
		const children = [child(1, { state: 'CLOSED' }), child(2, { blocked_by: [1] })]
		const result = epic_classify.classify_children(children, () => 'human')

		expect(numbers(result.human)).toEqual([2])
	})
})

describe('epic_classify.classify_children — the default resolver', () => {
	it('uses the closed-means-resolved rule when no resolver is supplied', () => {
		const children = [child(1, { state: 'CLOSED' }), child(2, { blocked_by: [1] })]

		expect(numbers(epic_classify.classify_children(children).runnable)).toEqual([2])
	})

	it('passes both ends of the dependency to the resolver', () => {
		const children = [child(1, { state: 'CLOSED' }), child(2, { blocked_by: [1] })]
		const seen: Array<string> = []

		epic_classify.classify_children(children, (blocker, blocked) => {
			seen.push(`${String(blocker.number)}->${String(blocked.number)}`)

			return 'resolved'
		})

		expect(seen).toEqual(['1->2'])
	})
})

describe('epic_classify.classify_children — every open child is accounted for', () => {
	it('places each open child in exactly one bucket', () => {
		const children = [
			child(1),
			child(2, { labels: [IN_PROGRESS_LABEL] }),
			child(3, { labels: [NEEDS_DECISION_LABEL] }),
			child(4, { state: 'CLOSED' }),
		]
		const result = epic_classify.classify_children(children)
		const placed = [...result.runnable, ...result.time, ...result.human]

		expect(numbers(placed).toSorted((left, right) => left - right)).toEqual([1, 2, 3])
	})
})

describe('epic_classify.local_category', () => {
	it('prefers the parked label over the running one', () => {
		const parked = child(1, { labels: [IN_PROGRESS_LABEL, NEEDS_DECISION_LABEL] })

		expect(epic_classify.local_category(parked)).toBe('human')
	})

	it('reports a closed child as done', () => {
		expect(epic_classify.local_category(child(1, { state: 'CLOSED' }))).toBe('done')
	})
})
