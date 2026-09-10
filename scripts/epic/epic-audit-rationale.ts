import type { DependencyLink } from '#scripts/git/git-epic-parse'
import { epic_audit_logic, type AuditFinding } from './epic-audit'
import type { AuditChild } from './epic-audit-checks'
import { epic_graph, type IssueReference } from './epic-graph'

// Check 6 — a declared order between two open children that nobody wrote a reason for
// (joshuafolkken/kit#1712).
//
// **Every other check looks the other way.** They report a dependency the epic *omitted* — prose or
// acceptance criteria naming a sibling with nothing ordering the two. Not one of them reads the
// declaration itself, so a chain somebody typed by hand passed the audit exactly as a justified one
// did: on 2026-09-10 the chain `#1690 -> #1694 -> #1703 -> #1679 -> #1675 -> #1676` serialized five
// otherwise independent children through `epicrun`, and the audit reported **0 errors** both while
// it stood and after it was deleted. It was found because a person asked why the backlog had gone
// single-file, which is not a mechanism.
//
// **Where a reason lives is already settled**, so this check does not invent a place to look:
// `josh epic --add --decision-file` writes the record to the epic's `## Decisions` **and** as a
// comment on each child, and `--remove` does the same for a deletion. Those two are the whole search.

const UNJUSTIFIED_ORDER = 'unjustified order'

// Both ends of one declared order, resolved to the children they name.
interface OrderPair {
	blocker: AuditChild
	blocked: AuditChild
}

interface RationaleInput {
	pairs: ReadonlyArray<OrderPair>
	// Every place the epic body records a reason: its `## Decisions` log and its `## Split rationale`,
	// as one text.
	decisions: string
	// Each pair end's comments, keyed by `epic_graph.key_of`. **An absent key means the listing could
	// not be read, and an empty array means it was read and holds nothing** — the two are different
	// facts, and `is_reportable` below is what keeps them apart.
	comments: ReadonlyMap<string, ReadonlyArray<string>>
	current_repo: string
}

const { key_of } = epic_graph

function find_child(
	children: ReadonlyArray<AuditChild>,
	reference: IssueReference,
): AuditChild | undefined {
	return children.find((candidate) => key_of(candidate) === key_of(reference))
}

// Whether this pair is one the check may speak about. Three conditions, and each excludes a case the
// finding would be wrong about rather than merely noisy:
//
// **Both ends open.** A settled order can no longer stall anything, which is the same reason
// `order_level` demotes a settled contradiction — and joshuafolkken/kit#1712 asks for it by name.
// **Both ends in the repository the audit runs in.** The comment listing reads that repository and
// takes no `--repo` (`git-gh-issue-read.ts`), so a cross-repository end's record cannot be read at
// all and every such order would be reported as unjustified whatever its author wrote.
function is_open_local(child: AuditChild, current_repo: string): boolean {
	return child.state !== 'CLOSED' && child.repo === current_repo
}

// The declared orders this check can speak about, resolved to children. A link naming something the
// epic does not track is left to `epic:next`'s own graph anomalies, which is where a declaration
// that names a stranger is already reported.
function order_pairs(
	links: ReadonlyArray<DependencyLink>,
	children: ReadonlyArray<AuditChild>,
	epic_repo: string,
	current_repo: string,
): Array<OrderPair> {
	return links.flatMap((link) => {
		const blocker = find_child(children, { repo: epic_repo, number: link.blocker })
		const blocked = find_child(children, { repo: epic_repo, number: link.blocked })
		if (blocker === undefined || blocked === undefined) return []

		return is_open_local(blocker, current_repo) && is_open_local(blocked, current_repo)
			? [{ blocker, blocked }]
			: []
	})
}

// The children whose comments have to be read to answer for these pairs.
function pair_ends(pairs: ReadonlyArray<OrderPair>): Array<AuditChild> {
	const seen = new Set<string>()

	return pairs
		.flatMap((pair) => [pair.blocker, pair.blocked])
		.filter((child) => {
			const is_new = !seen.has(key_of(child))

			seen.add(key_of(child))

			return is_new
		})
}

function named_keys(text: string, pair: OrderPair, current_repo: string): ReadonlySet<string> {
	const known = epic_audit_logic.known_repos([pair.blocker, pair.blocked], current_repo)

	return new Set(
		epic_audit_logic
			.parse_issue_references(text, current_repo, known)
			.map((reference) => key_of(reference)),
	)
}

// A comment on one end that names the **other** end. The issue it sits on is named by where it is,
// so a record posted on `#102` reads "placed after #101" and never repeats its own number — asking
// for both would refuse the exact wording `--decision-file` produces.
function has_record_on(
	input: RationaleInput,
	on: AuditChild,
	about: AuditChild,
	pair: OrderPair,
): boolean {
	return (input.comments.get(key_of(on)) ?? []).some((comment) =>
		named_keys(comment, pair, input.current_repo).has(key_of(about)),
	)
}

// **A comment is matched one at a time; the `## Decisions` section is matched whole, once.** A
// comment is one record by construction — `--decision-file` posts exactly one — so the question can
// be asked of a single comment. The section holds many records with no delimiter a reader can rely
// on, so it is asked the weaker question: does this section talk about both issues at all. That is
// deliberately generous, and generous is the right side for a finding that stops a run — it errs
// toward silence rather than toward accusing an author who did write the record.
function is_justified(input: RationaleInput, pair: OrderPair): boolean {
	const declared = named_keys(input.decisions, pair, input.current_repo)

	if (declared.has(key_of(pair.blocker)) && declared.has(key_of(pair.blocked))) return true

	return (
		has_record_on(input, pair.blocker, pair.blocked, pair) ||
		has_record_on(input, pair.blocked, pair.blocker, pair)
	)
}

// **An error rather than a warning**, and the choice is the one joshuafolkken/kit#1712 asks to be
// recorded.
//
// A warning would not be read: one real epic carries 447 of them, and the whole reason this check
// exists is that a false order was invisible. The counter-argument is `order_level`'s doctrine —
// where the machine cannot tell whether something is wrong, it warns — and it does not reach this
// check, because what is asserted here is not "this order is wrong". It is "this order's reason is
// not recorded", which is a fact about the repository's own rule that a placement decision is
// written down, not a judgement about the order.
//
// What makes the level affordable is that both remedies are now one command: `josh epic --remove`
// deletes the order, and `--decision-file` on either command records the reason. Before
// joshuafolkken/kit#1712 the first of those did not exist, and an error would have sent the reader
// to the hand edit `CLAUDE.md` forbids.
function unjustified_message(pair: OrderPair, current_repo: string): string {
	const blocker = epic_graph.format_reference(pair.blocker, current_repo)
	const blocked = epic_graph.format_reference(pair.blocked, current_repo)

	return (
		`The declared order ${blocker} -> ${blocked} has no recorded reason — neither the epic's ` +
		'`## Decisions` or `## Split rationale` section nor a comment on either issue mentions the ' +
		`other. Remove it with \`josh epic --remove <E> ${String(pair.blocker.number)} ` +
		`${String(pair.blocked.number)}\`, or record why with \`--decision-file\`, whose text has to ` +
		'name both issues for this check to find it.'
	)
}

// Whether both ends' comments were actually read. A listing that failed leaves its child out of the
// map, and judging that as "nobody recorded anything" turns a rate limit into an `error` that stops
// the epic over an order whose reason *was* written down. So a pair with an unread end is not
// reported at all — the audit says nothing rather than something false.
function is_reportable(input: RationaleInput, pair: OrderPair): boolean {
	return input.comments.has(key_of(pair.blocker)) && input.comments.has(key_of(pair.blocked))
}

function find_unjustified_orders(input: RationaleInput): Array<AuditFinding> {
	return input.pairs
		.filter((pair) => is_reportable(input, pair) && !is_justified(input, pair))
		.map((pair) => ({
			level: 'error' as const,
			check: UNJUSTIFIED_ORDER,
			message: unjustified_message(pair, input.current_repo),
		}))
}

const epic_audit_rationale = {
	UNJUSTIFIED_ORDER,
	order_pairs,
	pair_ends,
	find_unjustified_orders,
}

export { epic_audit_rationale }
export type { OrderPair, RationaleInput }
