import { describe, expect, it } from 'vitest'
import { epic_graph, type EpicChild, type IssueReference } from './epic-graph'

const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/joshuafolkken-com'

// Children are identified by repository and number: an epic can track both `#7` and `app-kit#7`, and
// keying by number alone had them overwrite each other (joshuafolkken/kit#864).
function key(number: number, repo = REPO): string {
	return `${repo}#${String(number)}`
}

// `blocked_by` is written as bare numbers because most cases keep the blocker in the child's own
// repository; `blockers` is the escape hatch for a relation that crosses one (joshuafolkken/kit#1126).
function child(
	number: number,
	blocked_by: ReadonlyArray<number> = [],
	repo = REPO,
	blockers?: ReadonlyArray<IssueReference>,
): EpicChild {
	return {
		number,
		repo,
		state: 'OPEN',
		labels: [],
		blocked_by: blockers ?? blocked_by.map((blocker) => ({ repo, number: blocker })),
	}
}

describe('epic_graph.find_stuck_children', () => {
	it('finds nothing in a plain chain', () => {
		expect(epic_graph.find_stuck_children([child(1), child(2, [1]), child(3, [2])])).toEqual([])
	})

	it('finds nothing when the children are independent', () => {
		expect(epic_graph.find_stuck_children([child(1), child(2), child(3)])).toEqual([])
	})

	// Two hand-added `--add-blocked-by` edges are all it takes, and every session would then wait
	// forever for the other half of the pair.
	it('finds a two-child cycle', () => {
		expect(epic_graph.find_stuck_children([child(1, [2]), child(2, [1])])).toEqual([key(1), key(2)])
	})

	it('finds a longer cycle', () => {
		const children = [child(1, [3]), child(2, [1]), child(3, [2])]

		expect(epic_graph.find_stuck_children(children)).toEqual([key(1), key(2), key(3)])
	})

	it('finds a child blocking itself', () => {
		expect(epic_graph.find_stuck_children([child(1, [1])])).toEqual([key(1)])
	})

	// A child behind a cycle never starts either, and telling the caller only about the cycle would
	// leave it wondering why that child never becomes runnable.
	it('includes the children a cycle blocks', () => {
		const children = [child(1, [2]), child(2, [1]), child(3, [1])]

		expect(epic_graph.find_stuck_children(children)).toEqual([key(1), key(2), key(3)])
	})

	it('ignores a blocker that is not a child of this epic', () => {
		expect(epic_graph.find_stuck_children([child(1, [999])])).toEqual([])
	})

	// A blocker number names an issue in the blocked child's own repository, so a child in another
	// repository with the same number is a different child entirely.
	it('does not treat a matching number in another repository as the blocker', () => {
		const remote: EpicChild = { ...child(1), repo: 'joshuafolkken/app-kit' }

		expect(epic_graph.find_stuck_children([remote, child(2, [1])])).toEqual([])
	})

	it('is decided by structure, not by state', () => {
		const closed: EpicChild = { ...child(1, [2]), state: 'CLOSED' }

		expect(epic_graph.find_stuck_children([closed, child(2, [1])])).toEqual([key(1), key(2)])
	})
})

describe('epic_graph.missing_relations', () => {
	it('accepts a declaration the relations record', () => {
		const links = [{ blocker: 1, blocked: 2 }]

		expect(epic_graph.missing_relations(links, [child(1), child(2, [1])], REPO)).toEqual([])
	})

	// An epic written before `josh` recorded the relations, or one whose recording failed, is the
	// ordinary way the two drift apart.
	it('reports a declaration with no matching relation', () => {
		const links = [{ blocker: 1, blocked: 2 }]

		expect(epic_graph.missing_relations(links, [child(1), child(2)], REPO)).toEqual(links)
	})
})

describe('epic_graph.undeclared_relations', () => {
	it('reports a relation the body never declares', () => {
		expect(epic_graph.undeclared_relations([], [child(1), child(2, [1])], REPO)).toEqual([
			{ blocker: 1, blocked: 2 },
		])
	})

	it('ignores a relation pointing outside the epic', () => {
		expect(epic_graph.undeclared_relations([], [child(1, [999])], REPO)).toEqual([])
	})

	// joshuafolkken/kit#1126: the number set was repository-blind, so a child elsewhere whose number
	// happened to equal a blocker's was reported as a relation nobody recorded.
	it('does not report a coincidence between two repositories', () => {
		const other = child(2, [], OTHER_REPO)
		const blocked = child(3, [], OTHER_REPO, [{ repo: OTHER_REPO, number: 2 }])

		expect(epic_graph.undeclared_relations([], [child(2), other, blocked], REPO)).toEqual([])
	})

	// A declared link is a bare number, which names the epic's own repository — so a relation that
	// crosses one is never something the body could have declared.
	it('leaves a cross-repository relation out of the declarable set', () => {
		const blocked = child(2, [], REPO, [{ repo: OTHER_REPO, number: 1 }])

		expect(epic_graph.undeclared_relations([], [child(1), blocked], REPO)).toEqual([])
	})
})

describe('epic_graph.find_anomalies', () => {
	it('reports nothing when the body and the relations agree', () => {
		const links = [{ blocker: 1, blocked: 2 }]

		expect(epic_graph.find_anomalies([child(1), child(2, [1])], links, true, REPO)).toEqual([])
	})

	it('reports a mismatch rather than picking a winner', () => {
		const [anomaly] = epic_graph.find_anomalies(
			[child(1), child(2)],
			[{ blocker: 1, blocked: 2 }],
			true,
			REPO,
		)

		expect(anomaly?.kind).toBe('declaration_mismatch')
		expect(anomaly?.message).toContain('will not choose for you')
	})

	it('names both directions of a disagreement', () => {
		const children = [child(1), child(2), child(3, [2])]
		const [anomaly] = epic_graph.find_anomalies(children, [{ blocker: 1, blocked: 2 }], true, REPO)

		expect(anomaly?.message).toContain('declared but not recorded: #1 -> #2')
		expect(anomaly?.message).toContain('recorded but not declared: #2 -> #3')
	})

	// A mismatch inside a cyclic graph is noise until the cycle is gone.
	// Without a declaration there is nothing for the relations to disagree with; reporting one would
	// fail every epic whose Dependencies section could not be read.
	it('reports no mismatch when the body declares no order at all', () => {
		expect(epic_graph.find_anomalies([child(1), child(2, [1])], [], false, REPO)).toEqual([])
	})

	it('reports the cycle first when both are wrong', () => {
		const children = [child(1, [2]), child(2, [1])]
		const anomalies = epic_graph.find_anomalies(children, [{ blocker: 9, blocked: 8 }], true, REPO)

		expect(anomalies).toHaveLength(1)
		expect(anomalies[0]?.kind).toBe('cycle')
	})
})
