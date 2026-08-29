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

export {
	git_epic_reference,
	DEPENDENCY_ARROW,
	REFERENCE_SEPARATOR,
	to_issue_reference,
	join_references,
	format_dependency_link,
	format_issue_references,
}
