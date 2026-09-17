import { epic_bundle, type BacklogIssue } from './epic-bundle'

// The facts the bundle decision was already made from, printed beside the order it prints
// (joshuafolkken/kit#1737).
//
// `is_strong_signal` reads exactly two things — whether a body names the other issue's number, and
// whether a `blocked-by` is already recorded in either direction — and neither ever reached the
// output. What did reach it was the verdict and, where relations happened to be recorded, the
// arrows. So confirming "should this issue really follow #123" meant opening both issue bodies and
// re-deriving by hand what the command had just finished reading. The facts cost nothing to fetch a
// second time: they are in hand at the moment the verdict is composed.
//
// **It states the facts and the direction they point, and stops there.** No line here says where to
// put the issue and none composes a command to run: ordering depends on intent, so a machine that
// decided it would write a confident order nobody's data supports. What is added is the material for
// the judgement, not the judgement.

// Which of the two readings a line came from. Kept apart in the data rather than only in the
// wording, so a caller can tell a recorded relation from a sentence somebody wrote.
type EvidenceKind = 'dependency' | 'reference'

// One fact, and the order it points to. `first` is the issue the fact puts ahead of `second`.
interface OrderingEvidence {
	kind: EvidenceKind
	first: number
	second: number
}

// The two readings, each written as a directed test of one issue against another. Both are
// `epic-bundle.ts`'s own, called rather than restated: the candidate search decides from exactly
// these, and a second spelling here would let the two disagree about what a signal is.
//
// **Both put the named issue first, and that is why one shape covers them.** A recorded
// `blocked-by` says so outright: the blocker has to land before the issue that declares it. A
// reference says it by having been written — the issue that names another was drafted with that
// other one already in existence, so the named one is the earlier of the two.
const EVIDENCE_TESTS: ReadonlyArray<{
	kind: EvidenceKind
	holds: (from: BacklogIssue, to: BacklogIssue) => boolean
}> = [
	{ kind: 'dependency', holds: (from, to) => epic_bundle.names_as_blocker(from, to) },
	{ kind: 'reference', holds: (from, to) => epic_bundle.names_in_body(from, to) },
]

// Both directions of one pair, because both are facts. Two issues that name each other produce two
// lines pointing opposite ways, which is the honest report: the reader is the one deciding.
function pair_evidence(subject: BacklogIssue, other: BacklogIssue): Array<OrderingEvidence> {
	const directions = [
		{ from: subject, to: other },
		{ from: other, to: subject },
	]

	return EVIDENCE_TESTS.flatMap(({ kind, holds }) =>
		directions
			.filter((pair) => holds(pair.from, pair.to))
			.map((pair) => ({ kind, first: pair.to.number, second: pair.from.number })),
	)
}

// Every unordered pair of the bundle's members.
//
// **The pairs are the ones `bundle_dependency_links` walks, not the subject's alone.** That function
// builds its member set as `[subject, ...candidates]` and emits an arrow for any pair of them, so an
// arrow between two candidates is ordinary — and evidence taken over the subject's pairs would leave
// exactly that arrow unexplained, which is the gap this whole block exists to close.
function member_pairs(
	members: ReadonlyArray<BacklogIssue>,
): Array<{ left: BacklogIssue; right: BacklogIssue }> {
	return members.flatMap((left, index) =>
		members.slice(index + 1).map((right) => ({ left, right })),
	)
}

// Every fact behind the bundle, over the members the order is drawn from.
//
// The repository filter is the one `bundle_dependency_links` applies: a bare number declared in a
// member elsewhere would be resolved against this repository by the epic body, naming a different
// issue entirely (joshuafolkken/kit#1130).
function ordering_evidence(
	subject: BacklogIssue,
	candidates: ReadonlyArray<BacklogIssue>,
): Array<OrderingEvidence> {
	const members = [subject, ...candidates].filter((member) => member.repo === subject.repo)

	return member_pairs(members).flatMap((pair) => pair_evidence(pair.left, pair.right))
}

// How each kind reads. `where` says the fact came from prose rather than from a recorded relation,
// and the two `order_*` halves say how strongly the fact settles the order.
//
// **A recorded dependency states the order; a reference only points at it.** A `blocked-by` says
// outright that the blocker lands first. A reference says it by having been written — which holds
// while a body is written once and stops holding the moment somebody edits an older issue to add a
// backlink to a newer one, as the review round cap and the upstream-interrupt rules both require. So
// the reference line reports the direction it points to and asserts nothing further; deciding is
// still the reader's.
const EVIDENCE_WORDING: Readonly<
	Record<EvidenceKind, { verb: string; where: string; order_prefix: string; order_suffix: string }>
> = {
	dependency: {
		verb: 'is recorded as blocked by',
		where: '',
		order_prefix: '',
		order_suffix: ' comes first',
	},
	reference: {
		verb: 'names',
		where: ' in its body',
		order_prefix: 'that points to ',
		order_suffix: ' first',
	},
}

const EVIDENCE_HEADING = '  Evidence:'
// One step deeper than the heading, which is itself indented under the verdict.
const EVIDENCE_INDENT_WIDTH = 4
const EVIDENCE_INDENT = ' '.repeat(EVIDENCE_INDENT_WIDTH)

function format_one(item: OrderingEvidence): string {
	const { verb, where, order_prefix, order_suffix } = EVIDENCE_WORDING[item.kind]
	const first = `#${String(item.first)}`
	const second = `#${String(item.second)}`
	const order = `${order_prefix}${first}${order_suffix}`

	return `${EVIDENCE_INDENT}${second} ${verb} ${first}${where} — ${order}`
}

// The block that goes under `Order:`. Empty when neither reading found anything, which leaves the
// existing `none declared — do not invent one` wording standing on its own.
function format_evidence(
	subject: BacklogIssue,
	candidates: ReadonlyArray<BacklogIssue>,
): Array<string> {
	const found = ordering_evidence(subject, candidates)
	if (found.length === 0) return []

	return [EVIDENCE_HEADING, ...found.map((item) => format_one(item))]
}

const epic_bundle_evidence = {
	EVIDENCE_HEADING,
	ordering_evidence,
	format_evidence,
}

export type { EvidenceKind, OrderingEvidence }
export { epic_bundle_evidence }
