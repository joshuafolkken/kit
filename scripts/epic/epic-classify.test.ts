import { IN_PROGRESS_LABEL, NEEDS_DECISION_LABEL } from '#scripts/git/issue-labels'
import { describe, expect, it, vi } from 'vitest'
import { epic_classify, type DependencyVerdict } from './epic-classify'
import type { EpicChild, IssueReference } from './epic-graph'

const REPO = 'joshuafolkken/kit'

interface ChildOptions {
	state?: 'OPEN' | 'CLOSED'
	labels?: ReadonlyArray<string>
	blocked_by?: ReadonlyArray<number>
	blockers?: ReadonlyArray<IssueReference>
	repo?: string
}

const CHILD_DEFAULTS = { repo: REPO, state: 'OPEN', labels: [] } as const

// `blocked_by` is written as bare numbers because most cases keep the blocker in the child's own
// repository; `blockers` is the escape hatch for a relation that crosses one (joshuafolkken/kit#1126).
function child(number: number, options: ChildOptions = {}): EpicChild {
	const { blocked_by = [], blockers, ...rest } = options
	const repo = options.repo ?? REPO

	return {
		...CHILD_DEFAULTS,
		...rest,
		number,
		blocked_by: blockers ?? blocked_by.map((blocker) => ({ repo, number: blocker })),
	}
}

function numbers(children: ReadonlyArray<EpicChild>): Array<number> {
	return children.map((entry) => entry.number)
}

const CONSUMER = 'joshuafolkken/joshuafolkken-com'

// A blocker in kit and the child it blocks in the consumer — the shape joshuafolkken/kit#1126 was
// measured on (joshuafolkken/joshuafolkken-com#870 blocked by joshuafolkken/kit#1125).
function cross_repo_children(state: 'OPEN' | 'CLOSED'): Array<EpicChild> {
	return [child(1, { state }), child(2, { repo: CONSUMER, blockers: [{ repo: REPO, number: 1 }] })]
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

// joshuafolkken/kit#1126: a `blocked-by` relation may cross a repository, and reading it as a bare
// number resolved it against the blocked child's own repository — an issue that does not exist, so
// `blocker_categories` dropped it and the child ran as though nothing blocked it. It also made
// `epic_cross_repo.resolve_cross_repo`'s cross-repository branch unreachable: every blocker arrived
// carrying the blocked child's repository, so `blocker.repo === blocked.repo` always held.
describe('epic_classify.classify_children — a blocker in another repository', () => {
	it('does not run a child whose blocker in another repository is still open', () => {
		const result = epic_classify.classify_children(cross_repo_children('OPEN'))

		expect(numbers(result.runnable)).toEqual([1])
		expect(numbers(result.time)).toEqual([2])
	})

	it("does not resolve the blocker against the blocked child's own repository", () => {
		const decoy = child(1, { repo: CONSUMER, state: 'CLOSED' })
		const children = [...cross_repo_children('OPEN'), decoy]
		const result = epic_classify.classify_children(children)

		expect(numbers(result.runnable)).not.toContain(2)
	})
})

describe('epic_classify.classify_children — the cross-repository resolver', () => {
	// The resolver is what decides a cross-repository dependency, and it could never be asked before:
	// `blocker.repo === blocked.repo` short-circuited every call to `resolved`.
	it("asks the resolver with the blocker's own repository", () => {
		const seen: Array<string> = []

		const resolve = (blocker: EpicChild, blocked: EpicChild): DependencyVerdict => {
			seen.push(`${blocker.repo}->${blocked.repo}`)

			return 'resolved'
		}

		epic_classify.classify_children(cross_repo_children('CLOSED'), resolve)

		expect(seen).toContain(`${REPO}->${CONSUMER}`)
	})

	// A closed blocker across a repository is not finished until its release is published, which is
	// what `resolve_cross_repo` answers `time` for (joshuafolkken/kit#864).
	it("waits when the closed blocker's release has not appeared yet", () => {
		const result = epic_classify.classify_children(cross_repo_children('CLOSED'), () => 'time')

		expect(numbers(result.time)).toEqual([2])
	})
})

// The last acceptance criterion of joshuafolkken/kit#1126: a relation the graph cannot place is
// reported rather than dropped in silence. Whether it should hold the child back is a separate
// question, and it belongs to joshuafolkken/kit#1123.
describe('epic_classify.classify_children — a blocker the epic does not track', () => {
	it('names the relation it could not weigh', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		epic_classify.classify_children([child(2, { blocked_by: [999] })])

		expect(warn.mock.calls.join('\n')).toContain('#999')
		expect(warn.mock.calls.join('\n')).toContain('does not track')
		warn.mockRestore()
	})

	it('says nothing when every blocker is a child of the epic', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		epic_classify.classify_children([child(1), child(2, { blocked_by: [1] })])

		expect(warn).not.toHaveBeenCalled()
		warn.mockRestore()
	})
})
