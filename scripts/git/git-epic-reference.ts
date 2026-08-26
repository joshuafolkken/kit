import type { DependencyLink } from './git-epic-parse'

// How an issue and a dependency between two of them are written down.
//
// Both spellings had accumulated a copy per module — the body generator, the graph, the chain model
// and the insertion planner each rendered `#N` and `#B -> #M` themselves. They are one-liners, which
// is exactly why the copies spread; and a link rendered one way in a message and another way as a
// dedup key is a difference nothing would report (joshuafolkken/kit#890).

const DEPENDENCY_ARROW = ' -> '

function to_issue_reference(issue_number: number): string {
	return `#${String(issue_number)}`
}

function format_dependency_link(link: DependencyLink): string {
	return `${to_issue_reference(link.blocker)}${DEPENDENCY_ARROW}${to_issue_reference(link.blocked)}`
}

function format_issue_references(issue_numbers: ReadonlyArray<number>): string {
	return issue_numbers.map((issue_number) => to_issue_reference(issue_number)).join(', ')
}

const git_epic_reference = {
	DEPENDENCY_ARROW,
	to_issue_reference,
	format_dependency_link,
	format_issue_references,
}

export {
	git_epic_reference,
	DEPENDENCY_ARROW,
	to_issue_reference,
	format_dependency_link,
	format_issue_references,
}
