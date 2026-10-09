// An issue named from outside any one graph — a task-list row, a citation in prose, a blocker
// relation, a child that could not be read. Repository **and** number, because a number alone cannot
// identify one: issue numbers are unique per repository, so the same `#40` names two different issues
// depending on who wrote it.
//
// It lives in the git layer because the `blocked-by` relations are read here and carry a repository
// of their own; the epic domain builds on this layer, never the other way
// round. `epic-reference` re-exports it, so every epic importer is unchanged.
//
// `state` is present only on a reference read from a `blocked-by` relation whose response carried it.
// The classifier needs it for a blocker no named graph tracks, where there is
// no child record to read the state from; every other reference leaves it out.
interface IssueReference {
	repo: string
	number: number
	state?: 'OPEN' | 'CLOSED'
}

export type { IssueReference }
