import {
	epic_audit_logic,
	type AuditFinding,
	type FindingLevel,
	type ReferenceState,
} from './epic-audit'
import { epic_graph, type EpicChild, type IssueReference } from './epic-graph'

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

// An issue's identity and how it is written, both taken from `epic_graph` rather than spelled a
// second time here: `epic:next` reports the same references and must write them the same way.
const { key_of } = epic_graph
const { known_repos } = epic_audit_logic

function shown(reference: IssueReference, current_repo: string): string {
	return epic_graph.format_reference(reference, current_repo)
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
// A pair in two different repositories used to be treated as ordered, unconditionally. That was not a
// statement about the pair but about what could be recorded: `blocked_by` was read as bare numbers,
// so a cross-repository order could not be written onto the graph at all, and reporting one as a
// contradiction would have failed the audit with no edit to either issue that could ever clear it.
// joshuafolkken/kit#1126 made such an order recordable and readable, so the premise stopped holding
// and joshuafolkken/kit#1128 removed the exemption: every pair is asked the same question now, and
// `depends_on` walks a cross-repository chain by identity exactly as it walks a local one. What keeps
// that from failing epics written before the capability existed is the finding's *level* rather than
// a blind spot — see `order_level`.
function is_ordered(
	index: ReadonlyMap<string, EpicChild>,
	child: AuditChild,
	other: AuditChild,
): boolean {
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
	known: ReadonlySet<string>,
): Array<AuditChild> {
	return epic_audit_logic
		.parse_issue_references(text, child.repo, known)
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
	known: ReadonlySet<string>,
): ReadonlySet<string> {
	const pairs = new Set<string>()

	for (const finding of findings) {
		const [first, second] = epic_audit_logic.parse_issue_references(
			finding.message,
			current_repo,
			known,
		)

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
	const known = known_repos(children, current_repo)
	const reported = reported_pairs(already_reported, current_repo, known)

	return children.flatMap((child) =>
		referenced_siblings(children, child, child.body ?? '', known)
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

// Whether this finding may stop a run. An `error` fails `epic:audit`, and `epicrun` runs the audit
// before its first child — so an error stops the whole epic at step one.
//
// Two cases are deliberately warnings, and they are warnings for different reasons.
//
// **Both children closed**: neither can run first any more, so the finding cannot describe anything
// that will happen.
//
// **A pair in two repositories** (joshuafolkken/kit#1128): that order only became recordable with
// joshuafolkken/kit#1126, so an error would fail the audit `epicrun` runs before its first child and
// stop every epic written before it — joshuafolkken/kit#1010 is what that looks like.
//
// **Be clear about what the warning does and does not buy.** It does *not* make the run safe: the
// finding fires precisely when nothing orders the pair, so there is no relation for `epic:next` to
// read and the child is offered as runnable — it can start before the work it cites. What changed is
// that this was previously *silent*, and is now said out loud. Making it safe means stopping, and
// stopping is what the recorded decision declined for epics that predate the capability. Clearing one
// means recording the relation; `josh epic --add` cannot write it yet (joshuafolkken/kit#1138), so
// until then it is the `dependencies/blocked_by` endpoint by hand.
function order_level(child: AuditChild, other: AuditChild, is_settled: boolean): FindingLevel {
	if (is_settled) return 'warning'

	return child.repo === other.repo ? 'error' : 'warning'
}

function order_finding(child: AuditChild, other: AuditChild, current_repo: string): AuditFinding {
	// Decided once and handed to both. Asked twice — once for the level, once for the wording — the
	// two could disagree, and the report would carry a level that contradicts the sentence under it.
	const is_settled = are_both_closed(child, other)

	return {
		level: order_level(child, other, is_settled),
		check: ORDER_CONTRADICTION,
		message: order_message(child, other, current_repo, is_settled),
	}
}

function find_order_contradictions(
	children: ReadonlyArray<AuditChild>,
	current_repo: string,
): Array<AuditFinding> {
	const index = epic_graph.index_children(children)
	const known = known_repos(children, current_repo)

	return children.flatMap((child) =>
		referenced_siblings(children, child, epic_audit_logic.acceptance_section(child.body), known)
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
	known: ReadonlySet<string>,
): Array<ReportedReference> {
	return epic_audit_logic
		.parse_issue_references(child.body ?? '', child.repo, known)
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
	const known = known_repos(children, current_repo)

	return children.flatMap((child) =>
		reported_references(child, states, known).map((reported) => ({
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
