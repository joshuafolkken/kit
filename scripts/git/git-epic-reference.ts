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

// A list of links, in the same form a single one takes. One definition rather than a `map().join()`
// per caller: the insertion planner and the relation reporter now print the same list side by side,
// and two spellings of it would read as two different things (joshuafolkken/kit#1080).
function format_dependency_links(links: ReadonlyArray<DependencyLink>): string {
	return join_references(links.map((link) => format_dependency_link(link)))
}

function format_issue_references(issue_numbers: ReadonlyArray<number>): string {
	return join_references(issue_numbers.map((issue_number) => to_issue_reference(issue_number)))
}

// The `blocked-by` relations a positioned `--add` dropped, named the same way wherever they are
// reported — on stdout and inside the `--decision-file` record (joshuafolkken/kit#1711). One string
// rather than two, because the two are read side by side: a reader comparing the console against the
// record must not have to decide whether two spellings mean the same thing.
//
// **Each chain is backticked, never bare and never several to a span.** A line that is *nothing but*
// `#A -> #B` is read as a dependency declaration anywhere in an epic body — which is what
// `find_decision_error` refuses a record for — and the `## Decisions` section is parsed with the rest
// of the body. The label in front already keeps this line out of that pattern; the backticks are what
// keeps it out if the label is ever reworded. One span **per link** rather than one around the list,
// because a relocation drops two at once and a single span holding `#890 -> #891, #891 -> #892` reads
// as one malformed chain in the artifact this line exists to leave behind.
function format_replaced_relations(links: ReadonlyArray<DependencyLink>): string {
	const quoted = links.map((link) => `\`${format_dependency_link(link)}\``)

	return `Replaced blocked-by: ${join_references(quoted)}.`
}

const git_epic_reference = {
	DEPENDENCY_ARROW,
	REFERENCE_SEPARATOR,
	to_issue_reference,
	join_references,
	format_dependency_link,
	format_dependency_links,
	format_issue_references,
	format_replaced_relations,
}

export type { IssueReference }
export {
	git_epic_reference,
	DEPENDENCY_ARROW,
	REFERENCE_SEPARATOR,
	to_issue_reference,
	join_references,
	format_dependency_link,
	format_dependency_links,
	format_issue_references,
	format_replaced_relations,
}
