import type { DependencyLink } from './git-epic-parse'

// How an issue and a dependency between two of them are written down.
//
// Both spellings had accumulated a copy per module — the body generator, the graph, the chain model
// and the insertion planner each rendered `#N` and `#B -> #M` themselves. They are one-liners, which
// is exactly why the copies spread; and a link rendered one way in a message and another way as a
// dedup key is a difference nothing would report (joshuafolkken/kit#890).

const DEPENDENCY_ARROW = ' -> '
// How a list of references is written out. One definition rather than a `join` per caller: the
// repository-aware list in `epic-graph` renders the same kind of list from a different element type,
// and two separators would let the two disagree over something a reader reads side by side.
const REFERENCE_SEPARATOR = ', '

// An issue named from outside any one graph — a task-list row, a citation in prose, a blocker
// relation, a child that could not be read. Repository **and** number, because a number alone cannot
// identify one: issue numbers are unique per repository, so the same `#40` names two different issues
// depending on who wrote it (joshuafolkken/kit#1014).
//
// It lives here rather than in `epic-graph` because the `blocked-by` relations are read in the git
// layer and carry a repository of their own (joshuafolkken/kit#1126) — a second declaration there
// would be the clone `CLAUDE.md` prohibits, and an import the other way would point the lower layer
// at the higher one. `epic-graph` re-exports it, so every existing importer is unchanged.
interface IssueReference {
	repo: string
	number: number
}

function to_issue_reference(issue_number: number): string {
	return `#${String(issue_number)}`
}

function format_dependency_link(link: DependencyLink): string {
	return `${to_issue_reference(link.blocker)}${DEPENDENCY_ARROW}${to_issue_reference(link.blocked)}`
}

function join_references(references: ReadonlyArray<string>): string {
	return references.join(REFERENCE_SEPARATOR)
}

function format_issue_references(issue_numbers: ReadonlyArray<number>): string {
	return join_references(issue_numbers.map((issue_number) => to_issue_reference(issue_number)))
}

const git_epic_reference = {
	DEPENDENCY_ARROW,
	REFERENCE_SEPARATOR,
	to_issue_reference,
	join_references,
	format_dependency_link,
	format_issue_references,
}

export type { IssueReference }
export {
	git_epic_reference,
	DEPENDENCY_ARROW,
	REFERENCE_SEPARATOR,
	to_issue_reference,
	join_references,
	format_dependency_link,
	format_issue_references,
}
