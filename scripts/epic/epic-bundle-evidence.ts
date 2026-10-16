import { issue_cite } from '#scripts/issue/issue-cite'
import type { SignalSection } from './epic-audit'
import { epic_bundle, type BacklogIssue } from './epic-bundle'

// The facts the bundle decision was already made from, printed beside the order it prints.
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
// `section` is where a reference was read, so the reader sees it was the acceptance criteria or the
// parent line that counted, not a mention elsewhere in the body.
interface OrderingEvidence {
	kind: EvidenceKind
	first: number
	second: number
	section?: SignalSection
}

// What one directed test found: nothing, or the fact with whatever detail it carries.
type EvidenceFound = Pick<OrderingEvidence, 'section'> | undefined

function blocker_found(from: BacklogIssue, to: BacklogIssue): EvidenceFound {
	return epic_bundle.names_as_blocker(from, to) ? {} : undefined
}

function reference_found(from: BacklogIssue, to: BacklogIssue): EvidenceFound {
	const section = epic_bundle.reference_section(from, to)

	return section === undefined ? undefined : { section }
}

// The two readings, each written as a directed test of one issue against another. Both are
// `epic-bundle.ts`'s own, called rather than restated: the candidate search decides from exactly
// these, and a second spelling here would let the two disagree about what a signal is.
//
// **Both put the named issue first, and that is why one shape covers them.** A recorded
// `blocked-by` says so outright: the blocker has to land before the issue that declares it. A
// reference says it by having been written — the issue that names another was drafted with that
// other one already in existence, so the named one is the earlier of the two.
interface EvidenceTest {
	kind: EvidenceKind
	find: (from: BacklogIssue, to: BacklogIssue) => EvidenceFound
}

const EVIDENCE_TESTS: ReadonlyArray<EvidenceTest> = [
	{ kind: 'dependency', find: blocker_found },
	{ kind: 'reference', find: reference_found },
]

// One test in one direction: the fact it found, or none.
function directed_evidence(
	test: EvidenceTest,
	from: BacklogIssue,
	to: BacklogIssue,
): Array<OrderingEvidence> {
	const found = test.find(from, to)
	if (found === undefined) return []

	return [{ kind: test.kind, first: to.number, second: from.number, ...found }]
}

// Both directions of one pair, because both are facts. Two issues that name each other produce two
// lines pointing opposite ways, which is the honest report: the reader is the one deciding.
function pair_evidence(subject: BacklogIssue, other: BacklogIssue): Array<OrderingEvidence> {
	const directions = [
		{ from: subject, to: other },
		{ from: other, to: subject },
	]

	return EVIDENCE_TESTS.flatMap((test) =>
		directions.flatMap((pair) => directed_evidence(test, pair.from, pair.to)),
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
// issue entirely.
function ordering_evidence(
	subject: BacklogIssue,
	candidates: ReadonlyArray<BacklogIssue>,
): Array<OrderingEvidence> {
	const members = [subject, ...candidates].filter((member) => member.repo === subject.repo)

	return member_pairs(members).flatMap((pair) => pair_evidence(pair.left, pair.right))
}

// How each kind reads. The two `order_*` halves say how strongly the fact settles the order; where a
// reference was read comes from the fact itself (`section_phrase`).
//
// **A recorded dependency states the order; a reference only points at it.** A `blocked-by` says
// outright that the blocker lands first. A reference says it by having been written — which holds
// while a body is written once and stops holding the moment somebody edits an older issue to add a
// backlink to a newer one, as the review round cap and the upstream-interrupt rules both require. So
// the reference line reports the direction it points to and asserts nothing further; deciding is
// still the reader's.
const EVIDENCE_WORDING: Readonly<
	Record<EvidenceKind, { verb: string; order_prefix: string; order_suffix: string }>
> = {
	dependency: { verb: 'is recorded as blocked by', order_prefix: '', order_suffix: ' comes first' },
	reference: { verb: 'names', order_prefix: 'that points to ', order_suffix: ' first' },
}

function section_phrase(item: OrderingEvidence): string {
	return item.section === undefined ? '' : ` in its ${item.section}`
}

const EVIDENCE_HEADING = '  Evidence:'
// One step deeper than the heading, which is itself indented under the verdict.
const EVIDENCE_INDENT_WIDTH = 4
const EVIDENCE_INDENT = ' '.repeat(EVIDENCE_INDENT_WIDTH)

function format_one(item: OrderingEvidence): string {
	const { verb, order_prefix, order_suffix } = EVIDENCE_WORDING[item.kind]
	const first = issue_cite.plain(item.first)
	const second = issue_cite.plain(item.second)
	const order = `${order_prefix}${first}${order_suffix}`

	return `${EVIDENCE_INDENT}${second} ${verb} ${first}${section_phrase(item)} — ${order}`
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
	format_evidence,
}

export type { EvidenceKind, OrderingEvidence }
export { epic_bundle_evidence }
