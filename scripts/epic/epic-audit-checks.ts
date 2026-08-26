import { epic_audit_logic, type AuditFinding } from './epic-audit'
import { epic_graph, type EpicChild } from './epic-graph'

// The four cross-child checks. Each takes the children with their bodies and returns findings.
//
// Warnings and errors are kept apart deliberately. An error is a contradiction that will stall the
// implementation whatever anyone decides — an acceptance criterion that needs something built later.
// A warning is a thing a reader has to look at: a child mentioning another child may be a real
// missing dependency or a perfectly good design note about what comes next, and the machine cannot
// tell. Making that an error would make legitimate notes unwritable, so the machine's job is to
// stop the omission going unnoticed, not to decide (joshuafolkken/kit#870).

const IMPLICIT_DEPENDENCY = 'implicit dependency'
const ORDER_CONTRADICTION = 'order contradiction'
const UNRESOLVED_REFERENCE = 'unresolved reference'
const ORPHAN_CHILD = 'orphan child'

// A child with its body, which the graph type does not carry.
interface AuditChild extends EpicChild {
	body: string | undefined
}

// Whether anything orders these two, in either direction. A sibling is named by number because that
// is how a body writes it; the child it refers to is the one in the same repository.
function is_ordered(
	index: ReadonlyMap<string, EpicChild>,
	child: AuditChild,
	other: number,
	children: ReadonlyArray<AuditChild>,
): boolean {
	const target = children.find(
		(candidate) => candidate.number === other && candidate.repo === child.repo,
	)
	if (target === undefined) return true

	return (
		epic_audit_logic.depends_on(index, child, target) ||
		epic_audit_logic.depends_on(index, target, child)
	)
}

function reference(issue_number: number): string {
	return `#${String(issue_number)}`
}

// The other children of this epic that `child`'s prose mentions.
function referenced_siblings(
	child: AuditChild,
	numbers: ReadonlySet<number>,
	text: string,
): Array<number> {
	return epic_audit_logic
		.parse_references(text, child.repo)
		.filter((other) => other !== child.number && numbers.has(other))
}

// The pairs check 2 already reported, so the same omission is not counted twice: the acceptance
// criteria are part of the body, so every order contradiction would otherwise also arrive as a
// warning and inflate the summary.
function reported_pairs(findings: ReadonlyArray<AuditFinding>): ReadonlySet<string> {
	const pairs = new Set<string>()

	for (const finding of findings) {
		const [first, second] = epic_audit_logic.parse_references(finding.message)

		if (first !== undefined && second !== undefined) {
			pairs.add(`${String(first)}->${String(second)}`)
		}
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
	already_reported: ReadonlyArray<AuditFinding> = [],
): Array<AuditFinding> {
	const index = epic_graph.index_children(children)
	const numbers = new Set(children.map((child) => child.number))
	const reported = reported_pairs(already_reported)

	return children.flatMap((child) =>
		referenced_siblings(child, numbers, child.body ?? '')
			.filter((other) => !reported.has(`${String(child.number)}->${String(other)}`))
			.filter((other) => !is_ordered(index, child, other, children))
			.map((other) => ({
				level: 'warning' as const,
				check: IMPLICIT_DEPENDENCY,
				message: `${reference(child.number)} refers to ${reference(other)}, but neither declares a dependency on the other.`,
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
function find_order_contradictions(children: ReadonlyArray<AuditChild>): Array<AuditFinding> {
	const index = epic_graph.index_children(children)
	const numbers = new Set(children.map((child) => child.number))

	return children.flatMap((child) =>
		referenced_siblings(child, numbers, epic_audit_logic.acceptance_section(child.body))
			.filter((other) => !is_ordered(index, child, other, children))
			.map((other) => ({
				level: 'error' as const,
				check: ORDER_CONTRADICTION,
				message: `${reference(child.number)} names ${reference(other)} in its acceptance criteria, but nothing orders the two — it can run first.`,
			})),
	)
}

// Check 3 — a body cites an issue that could not be resolved, or one that is already closed. Both
// mean the prose is describing something other than what is there.
//
// "Could not be resolved" rather than "does not exist": a `gh` failure and a genuinely absent issue
// are indistinguishable from here, and the documented response is to edit the prose — which must not
// be done on the strength of a transient lookup failure.
function find_unresolved_references(
	children: ReadonlyArray<AuditChild>,
	states: ReadonlyMap<number, 'OPEN' | 'CLOSED' | 'UNRESOLVED'>,
): Array<AuditFinding> {
	return children.flatMap((child) =>
		epic_audit_logic
			.parse_references(child.body ?? '', child.repo)
			.filter((other) => other !== child.number && states.has(other))
			.filter((other) => states.get(other) !== 'OPEN')
			.map((other) => ({
				level: 'warning' as const,
				check: UNRESOLVED_REFERENCE,
				message:
					states.get(other) === 'UNRESOLVED'
						? `${reference(child.number)} refers to ${reference(other)}, which could not be resolved — it does not exist, or the lookup failed.`
						: `${reference(child.number)} refers to ${reference(other)}, which is already closed.`,
			})),
	)
}

// Check 4 — an issue naming this epic as its parent that the epic's task list does not track. It
// would never be run, and the epic would close without it.
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
			message: `${reference(issue_number)} names this epic as its parent but is not in its task list.`,
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
