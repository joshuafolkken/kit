import { epic_classify, type ResolveDependency } from './epic-classify'
import { epic_graph, type EpicChild, type IssueReference } from './epic-graph'
import type { BlockersReader } from './epic-relation-recheck'
import { epic_report, type EpicVerdict } from './epic-report'

// joshuafolkken/kit#1121: the other direction of joshuafolkken/kit#1113's defect, checked where it
// would otherwise start work.
//
// `read_blocked_by` answers from the issue's own `issue_dependencies_summary` when that summary says
// zero, so a child whose counter is stale is read as `blocked_by: []`. joshuafolkken/kit#1113
// re-reads such a child only when the epic body *declared* the missing link, which is the direction
// that makes `epic:next` exit 1 on a graph with nothing to fix. A relation recorded but never
// declared leaves no trace in the body, so nothing marks the child as a suspect — and there the
// mistake runs the other way: the child is classified runnable and handed to an unattended run,
// which then implements a deliverable before the thing it needs. That is exactly the ordering
// joshuafolkken/kit#1005 exists to preserve.
//
// So the summary is not trusted for the one child that is about to be offered. The candidate's
// relations are read from the listing, and a listing that disagrees replaces that child's
// `blocked_by` before `epic_classify.classify_children` is run again. Re-running the classifier
// rather than testing the listing for emptiness is what makes a closed blocker and a cross-repository
// blocker come out right without this module knowing anything about either.

// Everything one confirmation walk needs: the children as the snapshot read them, the resolver the
// caller classifies with, and how to read one child's relations without consulting the summary.
interface ConfirmContext {
	children: ReadonlyArray<EpicChild>
	resolve: ResolveDependency
	read_blockers: BlockersReader
}

// The answer for one repository: the child to offer, or the verdict that stands in its place when
// every candidate was withheld.
interface RepoAnswer {
	child?: EpicChild
	verdict: EpicVerdict
}

// What one candidate's confirmation produced: whether it may be offered, and the children with the
// listing's correction applied. The corrected list is carried forward so a second candidate is
// classified against what the first read established rather than against the stale snapshot.
interface CandidateVerdict {
	is_confirmed: boolean
	children: ReadonlyArray<EpicChild>
}

const NO_ANOMALIES = 0

// Blocker sets, compared as sets: the listing and the summary-derived read need not agree on order,
// and a difference in order is not a difference in dependencies.
function is_same_blockers(
	left: ReadonlyArray<IssueReference>,
	right: ReadonlyArray<IssueReference>,
): boolean {
	const sorted = (blockers: ReadonlyArray<IssueReference>): string =>
		blockers
			.map((blocker) => epic_graph.key_of(blocker))
			.toSorted((first, second) => first.localeCompare(second))
			.join(',')

	return sorted(left) === sorted(right)
}

// The children with one child's relations replaced by what the listing returned. Matched by identity
// — repository and number — because two children of one epic can share a number across repositories.
function with_blockers(
	children: ReadonlyArray<EpicChild>,
	target: EpicChild,
	blocked_by: ReadonlyArray<IssueReference>,
): Array<EpicChild> {
	const key = epic_graph.key_of(target)

	return children.map((child) =>
		epic_graph.key_of(child) === key ? { ...child, blocked_by } : child,
	)
}

// Whether the corrected graph still calls this child runnable. The whole classifier is re-run rather
// than the listing tested for emptiness: a blocker that is closed, or one in another repository whose
// release has published, resolves the dependency, and only the classifier knows that.
function is_still_runnable(
	child: EpicChild,
	children: ReadonlyArray<EpicChild>,
	resolve: ResolveDependency,
): boolean {
	const key = epic_graph.key_of(child)

	return epic_classify
		.classify_children(children, resolve)
		.runnable.some((candidate) => epic_graph.key_of(candidate) === key)
}

// A read that failed withholds the candidate rather than confirming it. "Could not tell" is not
// "nothing blocks it", and this is the one direction the guard may not fail in, because that answer
// *starts* work — the same reason `epic-busy.ts` answers `wait` for a listing it could not read. The
// caller then offers the next candidate or waits, and the whole-run timeout bounds the wait.
async function read_or_withhold(
	candidate: EpicChild,
	read_blockers: BlockersReader,
): Promise<Array<IssueReference> | undefined> {
	try {
		return await read_blockers(candidate)
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error)

		console.warn(
			`⚠ could not confirm the blockers of #${String(candidate.number)}: ${reason}\n` +
				'  it is withheld rather than offered; asking again is what resolves this',
		)

		return undefined
	}
}

// Said out loud for the same reason a failed read is: the caller reports only that every candidate
// was withheld, and an operator reading that should not have to guess which relation did it.
function warn_withheld(candidate: EpicChild, listed: ReadonlyArray<IssueReference>): void {
	const named = listed.map((blocker) => epic_graph.key_of(blocker)).join(', ')

	console.warn(
		`⚠ #${String(candidate.number)} is withheld: its relations listing names ${named}, ` +
			'which the dependency summary it was classified from did not count',
	)
}

// Relations the listing recovered that this epic does not track as a child.
//
// `classify_children` drops such a blocker — "a blocker outside the epic is somebody else's problem"
// is `epic_graph`'s standing rule, and it applies to a relation the summary counted honestly exactly
// as it does to one it missed, so withholding only here would offer a child with a declared outside
// blocker while refusing the identical child whose counter went stale. The candidate is therefore
// still offered. What is new is that the run has just paid a request to learn the relation exists, so
// the discard is named rather than silent (joshuafolkken/kit#1121).
function untracked_blockers(
	listed: ReadonlyArray<IssueReference>,
	children: ReadonlyArray<EpicChild>,
): Array<IssueReference> {
	const index = epic_graph.index_children(children)

	return listed.filter((blocker) => !index.has(epic_graph.blocker_key(blocker)))
}

function warn_untracked(candidate: EpicChild, untracked: ReadonlyArray<IssueReference>): void {
	const named = untracked.map((blocker) => epic_graph.key_of(blocker)).join(', ')

	console.warn(
		`⚠ #${String(candidate.number)} is offered although its relations listing names ${named}: ` +
			'this epic does not track those, and its graph holds nothing to order them against',
	)
}

// What the confirmation learned, said out loud. Every disagreement between the listing and the
// summary produces a line, whichever way it was resolved.
function warn_recovered(
	candidate: EpicChild,
	listed: ReadonlyArray<IssueReference>,
	children: ReadonlyArray<EpicChild>,
	is_confirmed: boolean,
): void {
	if (!is_confirmed) {
		warn_withheld(candidate, listed)

		return
	}

	const untracked = untracked_blockers(listed, children)

	if (untracked.length > 0) warn_untracked(candidate, untracked)
}

// One candidate, confirmed against its own relations listing.
async function confirm_one(
	candidate: EpicChild,
	context: ConfirmContext,
): Promise<CandidateVerdict> {
	const listed = await read_or_withhold(candidate, context.read_blockers)
	if (listed === undefined) return { is_confirmed: false, children: context.children }

	if (is_same_blockers(candidate.blocked_by, listed)) {
		return { is_confirmed: true, children: context.children }
	}

	const children = with_blockers(context.children, candidate, listed)
	const is_confirmed = is_still_runnable(candidate, children, context.resolve)

	warn_recovered(candidate, listed, children, is_confirmed)

	return { is_confirmed, children }
}

// The bundle walked from its head until a candidate confirms.
//
// Walking on rather than making the whole repository wait is the recorded decision on
// joshuafolkken/kit#1108: a healthy sibling should not be held for one child whose counter is stale,
// and nobody repairs that counter — so the next poll would put the same child at the head and answer
// the same way, and the wait would never clear. The worst case is one request per candidate, and it
// happens only when every candidate is withheld, where the epic is broken and stopping is right.
async function confirm_candidate(
	candidates: ReadonlyArray<EpicChild>,
	context: ConfirmContext,
): Promise<CandidateVerdict & { child?: EpicChild }> {
	let { children } = context

	for (const candidate of candidates) {
		const verdict = await confirm_one(candidate, { ...context, children })

		children = verdict.children
		if (verdict.is_confirmed) return { is_confirmed: true, children, child: candidate }
	}

	return { is_confirmed: false, children }
}

// The verdict once every candidate was withheld, read off the corrected graph rather than assumed.
// `run` is still possible here — another repository may have work — and the caller's own
// `repo_verdict` maps that to `wait`, exactly as it does for a repository that never had a candidate.
function withheld_verdict(
	children: ReadonlyArray<EpicChild>,
	resolve: ResolveDependency,
): EpicVerdict {
	return epic_report.decide_verdict(
		epic_classify.classify_children(children, resolve),
		NO_ANOMALIES,
	)
}

// The answer for one repository. An empty bundle costs no request and re-derives the verdict the
// caller already had, so the path a repository with nothing to offer takes is unchanged.
async function answer_for_repo(
	candidates: ReadonlyArray<EpicChild>,
	context: ConfirmContext,
): Promise<RepoAnswer> {
	const outcome = await confirm_candidate(candidates, context)
	if (outcome.child !== undefined) return { child: outcome.child, verdict: 'run' }

	return { verdict: withheld_verdict(outcome.children, context.resolve) }
}

const epic_candidate_confirm = {
	is_same_blockers,
	untracked_blockers,
	with_blockers,
	is_still_runnable,
	confirm_candidate,
	withheld_verdict,
	answer_for_repo,
}

export type { ConfirmContext, RepoAnswer }
export { epic_candidate_confirm }
