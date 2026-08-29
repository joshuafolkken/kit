import {
	epic_audit_logic,
	type AuditFinding,
	type IssueReference,
	type ReferenceState,
} from './epic-audit'
import { epic_graph, type EpicChild } from './epic-graph'

// The four cross-child checks. Each takes the children with their bodies and returns findings.
//
// Warnings and errors are kept apart deliberately. An error is a contradiction that will stall the
// implementation whatever anyone decides — an acceptance criterion that needs something built later.
// A warning is a thing a reader has to look at: a child mentioning another child may be a real
// missing dependency or a perfectly good design note about what comes next, and the machine cannot
// tell. Making that an error would make legitimate notes unwritable, so the machine's job is to
// stop the omission going unnoticed, not to decide (joshuafolkken/kit#870).
//
// Every reference these checks read carries the repository it lives in, and every match is on
// repository and number both. A number alone names a different issue in every repository, so a
// cross-repository child citing `#40` was checked against *this* repository's issue 40
// (joshuafolkken/kit#1014).

const IMPLICIT_DEPENDENCY = 'implicit dependency'
const ORDER_CONTRADICTION = 'order contradiction'
const UNRESOLVED_REFERENCE = 'unresolved reference'
const ORPHAN_CHILD = 'orphan child'

// A child with its body, which the graph type does not carry.
interface AuditChild extends EpicChild {
	body: string | undefined
}

// A reference the resolver came back with something to say about.
interface ReportedReference {
	reference: IssueReference
	state: 'CLOSED' | 'UNRESOLVED'
}

// An issue's identity and how it is written, both taken from `epic_audit_logic` rather than spelled
// a second time here.
const { key_of } = epic_audit_logic

function shown(reference: IssueReference, current_repo: string): string {
	return epic_audit_logic.format_reference(reference, current_repo)
}

// The child a reference names, or nothing when it names an issue outside the epic. Extracted so the
// level decision below reads the same child this ordering test does — asking GitHub a second time
// for a state already on the record would be the duplication `CLAUDE.md` prohibits.
function find_sibling(
	children: ReadonlyArray<AuditChild>,
	reference: IssueReference,
): AuditChild | undefined {
	return children.find((candidate) => key_of(candidate) === key_of(reference))
}

// Whether anything orders these two, in either direction.
//
// A pair in two different repositories is treated as ordered, and that is a statement about what can
// be recorded rather than about this pair: `blocked_by` carries issue numbers with the repository
// dropped (`epic_issue.blockers_of`), so a cross-repository order cannot be written onto the graph at
// all. Reporting one as a contradiction would fail the audit with no edit to either issue that could
// ever clear it, and an error stops every `epicrun` on that epic at its first step. The rule is the
// one the pre-joshuafolkken/kit#1014 code applied by accident, when a sibling in another repository
// simply failed to resolve — kept deliberately now that such a sibling does resolve.
function is_ordered(
	index: ReadonlyMap<string, EpicChild>,
	child: AuditChild,
	other: AuditChild,
): boolean {
	if (child.repo !== other.repo) return true

	return (
		epic_audit_logic.depends_on(index, child, other) ||
		epic_audit_logic.depends_on(index, other, child)
	)
}

// The other children of this epic that `child`'s prose names, as children rather than numbers: a
// number cannot identify one, since two children may share a number across repositories.
function referenced_siblings(
	children: ReadonlyArray<AuditChild>,
	child: AuditChild,
	text: string,
): Array<AuditChild> {
	return epic_audit_logic
		.parse_issue_references(text, child.repo)
		.map((reference) => find_sibling(children, reference))
		.filter(
			(sibling): sibling is AuditChild =>
				sibling !== undefined && key_of(sibling) !== key_of(child),
		)
}

function pair_key(from: IssueReference, to: IssueReference): string {
	return `${key_of(from)}->${key_of(to)}`
}

// The pairs check 2 already reported, so the same omission is not counted twice: the acceptance
// criteria are part of the body, so every order contradiction would otherwise also arrive as a
// warning and inflate the summary.
//
// The messages are read back with the repository the audit runs in, which is the exact inverse of
// how `format_reference` wrote them: bare inside that repository, `owner/repo#N` outside it.
function reported_pairs(
	findings: ReadonlyArray<AuditFinding>,
	current_repo: string,
): ReadonlySet<string> {
	const pairs = new Set<string>()

	for (const finding of findings) {
		const [first, second] = epic_audit_logic.parse_issue_references(finding.message, current_repo)

		if (first !== undefined && second !== undefined) pairs.add(pair_key(first, second))
	}

	return pairs
}

// Check 1 — a child talks about another child, and neither declares a dependency on the other.
//
// A declared dependency in *either* direction is enough: `#864 depends on #863` makes `#863`'s note
// about `#864` an ordinary forward reference. What this catches is the shape found in
// joshuafolkken/kit#858 — two children each citing the other's deliverable, with `blocked_by` empty
// on both and the epic declaring them independent.
function find_implicit_dependencies(
	children: ReadonlyArray<AuditChild>,
	current_repo: string,
	already_reported: ReadonlyArray<AuditFinding> = [],
): Array<AuditFinding> {
	const index = epic_graph.index_children(children)
	const reported = reported_pairs(already_reported, current_repo)

	return children.flatMap((child) =>
		referenced_siblings(children, child, child.body ?? '')
			.filter((other) => !reported.has(pair_key(child, other)))
			.filter((other) => !is_ordered(index, child, other))
			.map((other) => ({
				level: 'warning' as const,
				check: IMPLICIT_DEPENDENCY,
				message: `${shown(child, current_repo)} refers to ${shown(other, current_repo)}, but neither declares a dependency on the other.`,
			})),
	)
}

// Check 2 — a child's acceptance criteria name another child, with no dependency in either
// direction. The criteria are where a child states what it must deliver, so a name there with
// nothing ordering the two is the contradiction found by hand in joshuafolkken/kit#858: the criteria
// required deliverables of children the graph let it run before.
//
// A declared dependency the *other* way is suppressed, and that suppression is what keeps the check
// honest. `#860`'s criteria say `#864` will extend a hook it provides, and `#864` is declared to
// depend on `#860` — a forward reference, and satisfiable exactly as written. Verified against the
// real epic: without this, four of the run's five errors were forward references of that shape.
//
// The level depends on whether either end still has execution left. What makes an undeclared order a
// contradiction is that the criteria's child *can run first*; once both children are closed that
// sentence is simply false, and an epic that ever forgot to declare an order would otherwise fail its
// audit forever — which stops every future `epicrun` on it at the first step, for something that can
// no longer stall anything (joshuafolkken/kit#1010). Confirmed on the real epic: `epic:next` handed
// back a runnable child while the audit was red.
//
// **Demoted rather than dropped**, and the choice is not cosmetic. Dropping the finding does not
// shorten the report: the acceptance criteria are part of the body, so the same pair falls straight
// through to check 1 — `reported_pairs` suppresses it only while this check reports it — and arrives
// as `implicit dependency` instead. Same line count, and the message loses the one thing that made it
// worth reading, that the name is in the *acceptance criteria*. So the history stays visible at the
// level that matches what is left to go wrong: nothing.
//
// Closed is asserted, never inferred: `epic_issue.normalize_state` maps everything that is not
// `CLOSED` — `MERGED` included — to `OPEN`, so a state this cannot confirm keeps the error. The
// unknown case falls to the loud side, which is the only side it may fall to.
function are_both_closed(child: AuditChild, target: AuditChild): boolean {
	return child.state === 'CLOSED' && target.state === 'CLOSED'
}

// Both wordings open with the same clause, and deliberately so: `reported_pairs` reads the first two
// references out of the message to suppress check 1's duplicate, so whichever level is chosen, the
// two numbers must appear in the same order.
function order_message(
	child: AuditChild,
	other: AuditChild,
	current_repo: string,
	is_settled: boolean,
): string {
	const named = `${shown(child, current_repo)} names ${shown(other, current_repo)} in its acceptance criteria`

	if (is_settled) {
		return `${named} with nothing ordering the two, but both are closed — neither can run first any more.`
	}

	return `${named}, but nothing orders the two — it can run first.`
}

function order_finding(child: AuditChild, other: AuditChild, current_repo: string): AuditFinding {
	const is_settled = are_both_closed(child, other)

	return {
		level: is_settled ? 'warning' : 'error',
		check: ORDER_CONTRADICTION,
		message: order_message(child, other, current_repo, is_settled),
	}
}

function find_order_contradictions(
	children: ReadonlyArray<AuditChild>,
	current_repo: string,
): Array<AuditFinding> {
	const index = epic_graph.index_children(children)

	return children.flatMap((child) =>
		referenced_siblings(children, child, epic_audit_logic.acceptance_section(child.body))
			.filter((other) => !is_ordered(index, child, other))
			.map((other) => order_finding(child, other, current_repo)),
	)
}

// Check 3 — a body cites an issue that could not be resolved, or one that is already closed. Both
// mean the prose is describing something other than what is there.
//
// "Could not be resolved" rather than "does not exist": a `gh` failure and a genuinely absent issue
// are indistinguishable from here, and the documented response is to edit the prose — which must not
// be done on the strength of a transient lookup failure.
function reported_state(
	states: ReadonlyMap<string, ReferenceState>,
	reference: IssueReference,
): 'CLOSED' | 'UNRESOLVED' | undefined {
	const state = states.get(key_of(reference))

	return state === 'OPEN' || state === undefined ? undefined : state
}

function reported_references(
	child: AuditChild,
	states: ReadonlyMap<string, ReferenceState>,
): Array<ReportedReference> {
	return epic_audit_logic
		.parse_issue_references(child.body ?? '', child.repo)
		.filter((reference) => key_of(reference) !== key_of(child))
		.flatMap((reference) => {
			const state = reported_state(states, reference)

			return state === undefined ? [] : [{ reference, state }]
		})
}

function unresolved_message(
	child: AuditChild,
	reported: ReportedReference,
	current_repo: string,
): string {
	const named = `${shown(child, current_repo)} refers to ${shown(reported.reference, current_repo)}`

	if (reported.state === 'UNRESOLVED') {
		return `${named}, which could not be resolved — it does not exist, or the lookup failed.`
	}

	return `${named}, which is already closed.`
}

function find_unresolved_references(
	children: ReadonlyArray<AuditChild>,
	states: ReadonlyMap<string, ReferenceState>,
	current_repo: string,
): Array<AuditFinding> {
	return children.flatMap((child) =>
		reported_references(child, states).map((reported) => ({
			level: 'warning' as const,
			check: UNRESOLVED_REFERENCE,
			message: unresolved_message(child, reported, current_repo),
		})),
	)
}

// Check 4 — an issue naming this epic as its parent that the epic's task list does not track. It
// would never be run, and the epic would close without it. Written bare: the search that finds these
// runs in the repository the command runs in, so there is no other repository for one to be in.
function find_orphans(
	tracked: ReadonlyArray<number>,
	claiming_children: ReadonlyArray<number>,
): Array<AuditFinding> {
	const known = new Set(tracked)

	return claiming_children
		.filter((issue_number) => !known.has(issue_number))
		.map((issue_number) => ({
			level: 'warning' as const,
			check: ORPHAN_CHILD,
			message: `#${String(issue_number)} names this epic as its parent but is not in its task list.`,
		}))
}

const epic_audit_checks = {
	IMPLICIT_DEPENDENCY,
	ORDER_CONTRADICTION,
	UNRESOLVED_REFERENCE,
	ORPHAN_CHILD,
	reported_pairs,
	find_implicit_dependencies,
	find_order_contradictions,
	find_unresolved_references,
	find_orphans,
}

export type { AuditChild }
export { epic_audit_checks }
