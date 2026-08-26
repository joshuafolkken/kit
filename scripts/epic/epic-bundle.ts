import type { DependencyLink } from '#scripts/git/git-epic-parse'
import { epic_audit_logic } from './epic-audit'

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
	// The epic tracking it, when one does. An issue belongs to at most one epic, because that is what
	// a task list can express.
	epic?: number
	// Whether this issue *is* an epic. An epic is a container, not a sibling: every child names it as
	// its parent, so without this every child would find its own epic as a candidate and be told to
	// bundle with it (joshuafolkken/kit#873, found by running the command on a real backlog).
	is_epic?: boolean
	blocked_by: ReadonlyArray<number>
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

// Whether a dependency is already recorded between the two.
function has_recorded_dependency(subject: BacklogIssue, other: BacklogIssue): boolean {
	return subject.blocked_by.includes(other.number) || other.blocked_by.includes(subject.number)
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
const ALREADY_TRACKED_REASON = 'this issue already belongs to an epic'
const SPREAD_REASON =
	'the related issues already belong to different epics; merging epics is not a call to make without asking'

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
		return { action: 'none', epics: [subject.epic], candidates: [], reason: ALREADY_TRACKED_REASON }
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
	const numbers = new Set(members.map((member) => member.number))

	return members.flatMap((member) =>
		member.blocked_by
			.filter((blocker) => numbers.has(blocker))
			.map((blocker) => ({ blocker, blocked: member.number })),
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
	NO_SIGNAL_REASON,
	ALREADY_TRACKED_REASON,
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
