import { backlog_overlap, type OverlapCandidate } from '#scripts/backlog/backlog-overlap'
import { defect_rate } from '#scripts/issue/defect-rate'
import { expected_effect_lint } from '#scripts/issue/expected-effect-lint'
import { issue_priority } from '#scripts/issue/issue-priority'
import { issue_rank, type DependencyRow } from '#scripts/issue/issue-rank'
import { size_estimate } from '#scripts/issue/size-estimate'
import { epic_graph, type EpicChild } from './epic-graph'

// `issue-rank.ts`'s keys over graph children, for both offer paths that hand
// out children: `backlog:next` (`backlog-rank.ts`) and a named epic's `epic:next --lanes`
// (`epic-lane-offer.ts`). One ranking, so the two cannot disagree about which child goes first.

const CLOSED = 'CLOSED'

function overlap_candidates(open: ReadonlyArray<EpicChild>, repo: string): Array<OverlapCandidate> {
	return open
		.filter((child) => child.repo === repo)
		.map((child) => ({
			key: epic_graph.key_of(child),
			paths: backlog_overlap.declared_paths(child.body ?? ''),
		}))
}

// The children whose declared paths meet each child's, weighed only within one repository: the same
// path in two repositories is two files.
function overlap_neighbors(
	open: ReadonlyArray<EpicChild>,
): ReadonlyMap<string, ReadonlySet<string>> {
	const repos = [...new Set(open.map((child) => child.repo))]

	return new Map(
		repos.flatMap((repo) => [...backlog_overlap.overlap_neighbors(overlap_candidates(open, repo))]),
	)
}

// The open issues of the pool as dependency rows, for how many wait on each child — directly, down a
// chain, or across a declared path overlap — and the highest priority among them. Only the pool is
// counted: it is every issue the caller may run, and an issue outside it is not one this ranking can
// start sooner.
function dependency_rows(pool: ReadonlyArray<EpicChild>): Array<DependencyRow> {
	const open = pool.filter((child) => child.state !== CLOSED)
	const neighbors = overlap_neighbors(open)

	return open.map((child) => ({
		key: epic_graph.key_of(child),
		labels: child.labels,
		blockers: child.blocked_by.map((blocker) => epic_graph.blocker_key(blocker)),
		overlaps: neighbors.get(epic_graph.key_of(child)),
	}))
}

function rank(
	children: ReadonlyArray<EpicChild>,
	pool: ReadonlyArray<EpicChild>,
): Array<EpicChild> {
	const rank_of = issue_rank.dependency_ranks(dependency_rows(pool))

	return issue_rank.rank(children, (child) => ({
		...rank_of(epic_graph.key_of(child)),
		is_resumable: child.is_resumable,
		is_defect: defect_rate.is_defect({ body: child.body ?? '', labels: child.labels }),
		is_last: issue_priority.is_last(child.body),
		labels: child.labels,
		lost_minutes: issue_priority.lost_minutes(child.body),
		gain_minutes: expected_effect_lint.weekly_minutes(child.body),
		estimated_lines: size_estimate.declared_size(child.body ?? '')?.lines,
	}))
}

const epic_rank = { rank }

export { epic_rank }
