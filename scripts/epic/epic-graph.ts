import type { DependencyLink } from '#scripts/git/git-epic-parse'
import {
	format_dependency_link,
	join_references,
	to_issue_reference,
} from '#scripts/git/git-epic-reference'

// The dependency graph an epic's children form, and the two ways it can be wrong.
//
// `epic:next` has to build this graph anyway to decide what is runnable, so the anomaly checks live
// here rather than in a separate auditor: a cycle makes every session wait forever, and a body that
// declares one order while the `blocked-by` relations record another means the implementation would
// proceed in an order nobody agreed to (joshuafolkken/kit#860).

// One child, as the graph sees it. `blocked_by` is the native relation; `repo` is the `owner/repo`
// the child lives in, so a caller can bundle candidates per repository.
interface EpicChild {
	number: number
	repo: string
	state: 'OPEN' | 'CLOSED'
	labels: ReadonlyArray<string>
	blocked_by: ReadonlyArray<number>
}

// What is wrong with the graph. Both stop the run — neither is something to pick a winner for.
type GraphAnomalyKind = 'cycle' | 'declaration_mismatch' | 'unreadable_children'

interface GraphAnomaly {
	kind: GraphAnomalyKind
	message: string
}

// An issue's identity across the whole epic. Issue numbers are unique per repository, not globally:
// an epic tracking both `#7` and `app-kit#7` has two different children, and keying by number alone
// had them overwrite each other — and had one's blockers resolve against the other
// (joshuafolkken/kit#864). The audit keys the issues its children *cite* the same way, through this
// one function rather than a second spelling of it (joshuafolkken/kit#1014).
function reference_key(repo: string, issue_number: number): string {
	return `${repo}${to_issue_reference(issue_number)}`
}

// An issue named from outside the graph — a task-list row, a citation in prose, a child that could
// not be read. Repository and number both, because a number alone cannot identify one: issue numbers
// are unique per repository, so the same `#40` names two different issues depending on who wrote it
// (joshuafolkken/kit#1014).
interface IssueReference {
	repo: string
	number: number
}

// An `EpicChild` is an `IssueReference` with more on it, so children and citations key the same way.
function key_of(reference: IssueReference): string {
	return reference_key(reference.repo, reference.number)
}

// How a reference is written in a message. Bare inside the repository the command runs in — the form
// every body writes and every existing message used — and `owner/repo#N` outside it, because a bare
// number resolves against the reader's own repository and names a different issue there
// (joshuafolkken/kit#864).
//
// It lives here rather than in the audit, beside the key it is the readable half of: `epic:next`
// reports the children it could not read too, and a second spelling there would print a bare `#7`
// for a child in another repository — the very misreading this exists to prevent
// (joshuafolkken/kit#1016).
function format_reference(reference: IssueReference, current_repo: string): string {
	const is_local = reference.repo === '' || reference.repo === current_repo

	return is_local ? to_issue_reference(reference.number) : key_of(reference)
}

function format_references(
	references: ReadonlyArray<IssueReference>,
	current_repo: string,
): string {
	return join_references(references.map((reference) => format_reference(reference, current_repo)))
}

// A blocker number, as a key in the repository that declared it. `blockedBy` numbers are issue
// numbers in the blocked child's own repository.
function blocker_key(child: EpicChild, blocker: number): string {
	return reference_key(child.repo, blocker)
}

// The children indexed by identity, for the lookups the walks below do repeatedly.
function index_children(children: ReadonlyArray<EpicChild>): Map<string, EpicChild> {
	return new Map(children.map((child) => [key_of(child), child]))
}

// A child's blockers that belong to this epic, as keys. A blocker outside the epic is somebody
// else's problem — the resolver decides whether it counts, and it can never be part of a cycle here.
function blockers_of(index: ReadonlyMap<string, EpicChild>, node: string): ReadonlyArray<string> {
	const child = index.get(node)
	if (child === undefined) return []

	return child.blocked_by.map((blocker) => blocker_key(child, blocker))
}

function has_remaining_blocker(
	index: ReadonlyMap<string, EpicChild>,
	node: string,
	remaining: ReadonlySet<string>,
): boolean {
	return blockers_of(index, node).some((blocker) => remaining.has(blocker))
}

// The children that can never start, found by peeling: repeatedly drop every child whose blockers
// have all been dropped. What survives is in a cycle, or blocked by one — and both are the same
// problem for a caller, since neither will ever become runnable no matter how long it waits.
//
// Peeling rather than a depth-first search for a back edge: it is iterative, needs no node marking, and
// its answer is the more useful one. Purely structural, so a child's state and labels do not enter
// into it — a cycle is wrong whether or not anything in it has been closed.
function find_stuck_children(children: ReadonlyArray<EpicChild>): Array<string> {
	const index = index_children(children)
	const remaining = new Set(children.map((child) => key_of(child)))

	const peel = (): number => {
		const ready = [...remaining].filter((node) => !has_remaining_blocker(index, node, remaining))

		for (const node of ready) remaining.delete(node)

		return ready.length
	}

	while (peel() > 0) {
		/* keep peeling until a pass drops nothing */
	}

	return [...remaining].toSorted((left, right) => left.localeCompare(right))
}

// Whether a declared link is actually recorded as a native relation on the blocked child. Declared
// links are always written as bare numbers, which name issues in the epic's own repository.
function is_link_recorded(link: DependencyLink, children: ReadonlyArray<EpicChild>): boolean {
	return children.some(
		(child) => child.number === link.blocked && child.blocked_by.includes(link.blocker),
	)
}

// Declared links with no matching relation. Reported rather than applied: a body may legitimately be
// ahead of the relations — an epic written before `josh` recorded them, or one whose recording
// failed — and a run that silently followed the relations would ignore the order that was actually
// agreed.
function missing_relations(
	links: ReadonlyArray<DependencyLink>,
	children: ReadonlyArray<EpicChild>,
): Array<DependencyLink> {
	return links.filter((link) => !is_link_recorded(link, children))
}

// Every relation recorded on one child, as links between children of this epic.
function child_links(child: EpicChild, numbers: ReadonlySet<number>): Array<DependencyLink> {
	return child.blocked_by
		.filter((blocker) => numbers.has(blocker))
		.map((blocker) => ({ blocker, blocked: child.number }))
}

// Relations recorded between children that the body never declares. The other direction of the same
// disagreement: someone added `--add-blocked-by` by hand and the epic body still says otherwise.
function undeclared_relations(
	links: ReadonlyArray<DependencyLink>,
	children: ReadonlyArray<EpicChild>,
): Array<DependencyLink> {
	const declared = new Set(links.map((link) => format_dependency_link(link)))
	const numbers = new Set(children.map((child) => child.number))

	return children
		.flatMap((child) => child_links(child, numbers))
		.filter((link) => !declared.has(format_dependency_link(link)))
}

function cycle_anomaly(stuck: ReadonlyArray<string>): GraphAnomaly {
	const list = stuck.join(', ')

	return {
		kind: 'cycle',
		message: `Circular dependency: ${list} can never start — each is blocked, directly or through a chain, by something that is itself waiting on the group.`,
	}
}

function mismatch_anomaly(
	missing: ReadonlyArray<DependencyLink>,
	undeclared: ReadonlyArray<DependencyLink>,
): GraphAnomaly {
	const lines = [
		'The epic body and the blocked-by relations disagree.',
		...missing.map((link) => `  declared but not recorded: ${format_dependency_link(link)}`),
		...undeclared.map((link) => `  recorded but not declared: ${format_dependency_link(link)}`),
		'Fix one of them; the run will not choose for you.',
	]

	return { kind: 'declaration_mismatch', message: lines.join('\n') }
}

// Everything wrong with the graph, in the order a caller should act on it: a cycle first, because a
// mismatch inside a cyclic graph is noise until the cycle is gone.
//
// `is_declared` says whether the body states an order at all — a chain, or the explicit sentence
// declaring the children independent. Without one there is nothing for the relations to disagree
// with, and reporting a mismatch against a body that never spoke would fail every epic whose
// declaration could not be read.
function find_anomalies(
	children: ReadonlyArray<EpicChild>,
	links: ReadonlyArray<DependencyLink>,
	is_declared: boolean,
): Array<GraphAnomaly> {
	const stuck = find_stuck_children(children)
	if (stuck.length > 0) return [cycle_anomaly(stuck)]
	if (!is_declared) return []
	const missing = missing_relations(links, children)
	const undeclared = undeclared_relations(links, children)
	if (missing.length === 0 && undeclared.length === 0) return []

	return [mismatch_anomaly(missing, undeclared)]
}

const epic_graph = {
	reference_key,
	key_of,
	format_reference,
	format_references,
	blocker_key,
	index_children,
	blockers_of,
	find_stuck_children,
	missing_relations,
	undeclared_relations,
	find_anomalies,
}

export type { EpicChild, GraphAnomaly, GraphAnomalyKind, IssueReference }
export { epic_graph }
