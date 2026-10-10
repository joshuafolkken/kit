import { issue_rank } from '#scripts/issue/issue-rank'
import { epic_graph, type EpicChild } from './epic-graph'

// `issue-rank.ts`'s keys over graph children, for both offer paths that hand
// out children: `backlog:next` (`backlog-rank.ts`) and a named epic's `epic:next --lanes`
// (`epic-lane-offer.ts`). One ranking, so the two cannot disagree about which child goes first.

const CLOSED = 'CLOSED'

// How many open issues of the pool wait on each child. Only the pool is counted: it is every issue the
// caller may run, and an issue outside it is not one this ranking can start sooner.
function dependents_of(pool: ReadonlyArray<EpicChild>): ReadonlyMap<string, number> {
	return issue_rank.count_dependents(
		pool
			.filter((child) => child.state !== CLOSED)
			.map((child) => ({
				key: epic_graph.key_of(child),
				blockers: child.blocked_by.map((blocker) => epic_graph.blocker_key(blocker)),
			})),
	)
}

function rank(
	children: ReadonlyArray<EpicChild>,
	pool: ReadonlyArray<EpicChild>,
): Array<EpicChild> {
	const dependents = dependents_of(pool)

	return issue_rank.rank(children, (child) => ({
		labels: child.labels,
		dependents: dependents.get(epic_graph.key_of(child)) ?? 0,
	}))
}

const epic_rank = { rank }

export { epic_rank }
