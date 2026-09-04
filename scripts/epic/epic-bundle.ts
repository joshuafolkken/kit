import type { DependencyLink } from '#scripts/git/git-epic-parse'
import type { IssueReference } from '#scripts/git/git-epic-reference'
import { epic_audit_logic } from './epic-audit'
import { epic_graph } from './epic-graph'

// Bundling a newly filed issue with the ones it turns out to be related to.
//
// "Two or more always means an epic" already holds when one request is split on the spot. It does
// not reach the other way in: two issues filed days apart that turn out to be the front and back of
// one job are executed separately, in whatever order, with the reasoning recorded nowhere
// (joshuafolkken/kit#873).
//
// The candidate search reads issue references out of prose — the same reading joshuafolkken/kit#870
// does inside one epic. That analysis is imported rather than written a second time; the only
// difference is what it is pointed at.

// An open issue as the search sees it.
interface BacklogIssue {
	number: number
	repo: string
	body: string
	// Optional because nothing in this module reads it: the strong signals below are references and
	// recorded dependencies, and a title resemblance is deliberately not one of them. It rides on the
	// same listing for `issue:scout`, whose duplicate search is the one thing that does compare titles
	// (joshuafolkken/kit#1252), and is absent on an issue read one at a time by reference.
	title?: string
	// The epic tracking it, when one does. An issue belongs to at most one epic, because that is what
	// a task list can express.
	epic?: number
	// Whether this issue *is* an epic. An epic is a container, not a sibling: every child names it as
	// its parent, so without this every child would find its own epic as a candidate and be told to
	// bundle with it (joshuafolkken/kit#873, found by running the command on a real backlog).
	is_epic?: boolean
	// Repository-qualified, not bare numbers (joshuafolkken/kit#1130). Issue numbers are unique per
	// repository, so a blocker read as `40` alone matched any candidate numbered 40 — including one in
	// a different repository entirely. That produced a bundle nobody's data supported, and, through
	// `bundle_dependency_links`, a `blocked-by` relation recorded onto the wrong issue: a write, not
	// only a misreading.
	blocked_by: ReadonlyArray<IssueReference>
}

// What to do with the candidates found. Bundling is reversible — an epic is editable and a child can
// be removed — so it needs no confirmation. Merging epics is not, so it does.
type BundleAction = 'add_to_epic' | 'create_epic' | 'ask' | 'none'

interface BundleDecision {
	action: BundleAction
	// The epic to add to, for `add_to_epic`.
	epic?: number
	// The epics the candidates are spread across, for `ask`.
	epics: ReadonlyArray<number>
	candidates: ReadonlyArray<number>
	reason: string
}

// Whether two issues cite each other, in either direction. A one-way citation is enough: the point
// is that somebody wrote one issue while thinking about the other.
function has_mutual_reference(subject: BacklogIssue, other: BacklogIssue): boolean {
	const from_subject = epic_audit_logic.parse_references(subject.body, subject.repo)
	const from_other = epic_audit_logic.parse_references(other.body, other.repo)

	return from_subject.includes(other.number) || from_other.includes(subject.number)
}

// Whether `blocked` names `blocker` in its recorded relations. Compared by identity — repository and
// number — through the same key the epic graph uses, rather than a second spelling of the comparison.
function names_as_blocker(blocked: BacklogIssue, blocker: BacklogIssue): boolean {
	const wanted = epic_graph.key_of(blocker)

	return blocked.blocked_by.some((recorded) => epic_graph.key_of(recorded) === wanted)
}

// Whether a dependency is already recorded between the two, in either direction.
function has_recorded_dependency(subject: BacklogIssue, other: BacklogIssue): boolean {
	return names_as_blocker(subject, other) || names_as_blocker(other, subject)
}

// A strong signal, and only a strong signal.
//
// Similar titles are deliberately not one. "Related" expands without limit, and a threshold is what
// keeps an unrelated issue out of the bundle; a wording resemblance may inform the reader's
// judgement, but it may not be what decides.
function is_strong_signal(subject: BacklogIssue, other: BacklogIssue): boolean {
	if (subject.number === other.number) return false
	// Neither side. Asked about an epic, the one-sided check found every one of its children through
	// their own `parent: #N` line and proposed bundling a container with its contents.
	if (subject.is_epic === true || other.is_epic === true) return false

	return has_mutual_reference(subject, other) || has_recorded_dependency(subject, other)
}

function find_candidates(
	subject: BacklogIssue,
	backlog: ReadonlyArray<BacklogIssue>,
): Array<BacklogIssue> {
	return backlog.filter((other) => is_strong_signal(subject, other))
}

// The distinct epics the candidates already belong to.
function candidate_epics(candidates: ReadonlyArray<BacklogIssue>): Array<number> {
	const epics = new Set<number>()

	for (const candidate of candidates) {
		if (candidate.epic !== undefined) epics.add(candidate.epic)
	}

	return [...epics].toSorted((left, right) => left - right)
}

const NO_SIGNAL_REASON = 'no existing issue shares a reference or a dependency with this one'

// Names the epic, rather than only reporting that one exists. The number is what the caller does
// something with: the prerequisite procedure inserts into that epic instead of creating a second one,
// and an issue tracked by two epics gives the auto-close two task lists to disagree about
// (joshuafolkken/kit#943). The decision already carried the number; only this sentence dropped it.
function already_tracked_reason(epic: number): string {
	return `#${String(epic)} already tracks this issue`
}

const SPREAD_REASON =
	'the related issues already belong to different epics; pick the one this issue belongs in and record why'

function to_numbers(candidates: ReadonlyArray<BacklogIssue>): Array<number> {
	return candidates.map((candidate) => candidate.number)
}

function create_decision(subject: BacklogIssue, numbers: ReadonlyArray<number>): BundleDecision {
	const count = String(numbers.length)
	const reason = `#${String(subject.number)} and ${count} related issue(s) belong to no epic`

	return { action: 'create_epic', epics: [], candidates: numbers, reason }
}

// Which of the three the candidates call for, once there is at least one.
function decide_with_candidates(
	subject: BacklogIssue,
	candidates: ReadonlyArray<BacklogIssue>,
): BundleDecision {
	const numbers = to_numbers(candidates)
	const epics = candidate_epics(candidates)
	if (epics.length > 1) return { action: 'ask', epics, candidates: numbers, reason: SPREAD_REASON }
	const [epic] = epics
	if (epic === undefined) return create_decision(subject, numbers)
	const reason = `#${String(epic)} already tracks a related issue`

	return { action: 'add_to_epic', epic, epics: [epic], candidates: numbers, reason }
}

// What to do about the candidates. An epic is created only when the subject plus at least one
// unbundled candidate make two — an epic tracking one child is not a batch.
function decide_bundle(
	subject: BacklogIssue,
	backlog: ReadonlyArray<BacklogIssue>,
): BundleDecision {
	// An issue an epic already tracks has nothing to bundle: it belongs to at most one, and moving it
	// between epics is not what this rule is for.
	if (subject.epic !== undefined) {
		return {
			action: 'none',
			epics: [subject.epic],
			candidates: [],
			reason: already_tracked_reason(subject.epic),
		}
	}

	const candidates = find_candidates(subject, backlog)

	if (candidates.length === 0) {
		return { action: 'none', epics: [], candidates: [], reason: NO_SIGNAL_REASON }
	}

	return decide_with_candidates(subject, candidates)
}

// The dependency links a bundle should record, from what the candidates already declare. Bundling
// without the order records the batch and loses the reason it is a batch — an issue that must follow
// another is exactly the case this exists to catch (joshuafolkken/kit#873).
//
// Only relations already declared are carried over; an order nobody stated is not invented here.
function bundle_dependency_links(
	subject: BacklogIssue,
	candidates: ReadonlyArray<BacklogIssue>,
): Array<DependencyLink> {
	const members = [subject, ...candidates]
	const keys = new Set(members.map((member) => epic_graph.key_of(member)))
	// The bundle's own repository, which is what a bare declared number names. Taken from the subject
	// rather than from each member: comparing a blocker against its *own* member's repository would
	// let two members elsewhere emit a link between them, and the epic body would then resolve those
	// bare numbers against this repository — a different pair of issues. `epic_graph.child_links`
	// guards the identical case the identical way (joshuafolkken/kit#1130).
	const declared_repo = subject.repo

	return members
		.filter((member) => member.repo === declared_repo)
		.flatMap((member) =>
			member.blocked_by
				.filter((blocker) => blocker.repo === declared_repo && keys.has(epic_graph.key_of(blocker)))
				.map((blocker) => ({ blocker: blocker.number, blocked: member.number })),
		)
}

// The children a new epic would track, in number order so the batch reads the way it was filed.
function bundle_children(
	subject: BacklogIssue,
	candidates: ReadonlyArray<BacklogIssue>,
): Array<number> {
	return [subject.number, ...to_numbers(candidates)].toSorted((left, right) => left - right)
}

const epic_bundle = {
	names_as_blocker,
	NO_SIGNAL_REASON,
	already_tracked_reason,
	SPREAD_REASON,
	has_mutual_reference,
	has_recorded_dependency,
	is_strong_signal,
	find_candidates,
	candidate_epics,
	decide_bundle,
	bundle_dependency_links,
	bundle_children,
}

export type { BacklogIssue, BundleAction, BundleDecision }
export { epic_bundle }
