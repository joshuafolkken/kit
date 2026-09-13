import type { ConfirmContext } from './epic-candidate-confirm'
import { epic_cross_repo } from './epic-cross-repo'
import { epic_fetch, type EpicSnapshot } from './epic-fetch'
import { epic_graph } from './epic-graph'
import type { EpicReference } from './epic-issue'
import { epic_lane_offer, type RepoPool } from './epic-lane-offer'
import { epic_report, type EpicNextResult, type EpicVerdict } from './epic-report'

// Several epics, answered as one (joshuafolkken/kit#1493).
//
// joshuafolkken/kit#1491 built the lane pool epic-agnostic on purpose: `epic-lane-offer.ts` takes an
// array of `RepoPool`s and nothing below it knows what an epic is. What was still fixed at one was
// the *caller* — `epic:next` read a single reference and built a single pool — so a repository with
// six free lanes could only ever fill them from one graph. This module is that caller's other half:
// one view per named epic, merged into one pool list and one verdict.
//
// **The priority order is the order the epics were named**, and it is a decision rather than a
// fallback. Dependency depth was the alternative and it does not compare across graphs: depth is
// measured inside one epic, so a depth-2 child of a five-deep epic and a depth-2 child of a two-deep
// one make the same claim about entirely different amounts of remaining work, and there is no
// relation between two epics to normalize against. Argument order is the one ranking a person typed
// and can change, `epic_lane_offer.collect` already walks pools in the order it is given, and the
// answer is readable from the output because each epic's block is headed by its own reference.
// **Inside one epic nothing moves**: that epic's declared chain still decides which of its children
// is a candidate, and this order only decides whose candidate takes a free lane first.

const COMPLETE_VERDICT: EpicVerdict = 'complete'
const ERROR_VERDICT: EpicVerdict = 'error'
const ONE_EPIC = 1
const BLOCK_SEPARATOR = '\n\n'

// One epic, from its reference through to the classification of its children. The reference is kept
// beside the snapshot because `EpicSnapshot` carries the repository the epic lives in but not the
// epic's own number, and a multi-epic report has to say which graph a block came from.
interface EpicView {
	reference: EpicReference
	snapshot: EpicSnapshot
	result: EpicNextResult
	// Every issue this invocation may run — the children of all the named epics, plus a backlog's
	// standalone issues — which a candidate's blockers are re-weighed against at confirmation
	// (joshuafolkken/kit#1943). Absent, a view confirms against its own epic's children alone.
	running?: ReadonlySet<string>
}

// Written exactly as it was typed. A bare number stays bare, because qualifying it here would name
// this repository in an answer about an epic the caller referred to without one.
function format_reference(reference: EpicReference): string {
	return `${reference.repo ?? ''}#${String(reference.number)}`
}

// What the candidate confirmation reads with. The blockers come from `epic_fetch`'s own reader, so
// a candidate is addressed exactly as every other read of a child is — a cross-repository child
// through its own repository, and a local one bare (joshuafolkken/kit#1012).
function confirm_context(snapshot: EpicSnapshot, running?: ReadonlySet<string>): ConfirmContext {
	return {
		children: snapshot.children,
		running,
		resolve: epic_cross_repo.resolve_cross_repo,
		read_blockers: async (child) =>
			await epic_fetch.read_child_blockers(child, snapshot.current_repo),
	}
}

// One pool per epic rather than one merged candidate list, because each pool is confirmed against
// its own graph — the context is what a candidate's blockers are re-read with, and two epics are two
// contexts. Merging the candidates into one array would confirm a child of epic B against epic A's
// children. The de-duplication that keeps a child tracked by both epics out of the second pool is
// `epic_lane_offer.dedupe_pools`, which runs where the pools are spent.
function pools_of(views: ReadonlyArray<EpicView>, repo: string): ReadonlyArray<RepoPool> {
	return views.map((view) => ({
		candidates: epic_report.candidates_for_repo(view.result, repo),
		context: confirm_context(view.snapshot, view.running),
	}))
}

// The verdict standing in for every named epic when none of them offered a child. Combined through
// `epic_lane_offer.combine_verdicts` — the same ranking the pool merge uses — so the two halves of a
// multi-epic answer cannot disagree about which reason wins.
// `error` is absent from that ranking and therefore outranks everything in it, which is the reading
// this wants — but `error_view` below is what every caller acts on first, so no decision rests on
// the absence.
function combined_verdict(views: ReadonlyArray<EpicView>): EpicVerdict {
	let verdict: EpicVerdict = COMPLETE_VERDICT

	for (const view of views) verdict = epic_lane_offer.combine_verdicts(verdict, view.result.verdict)

	return verdict
}

// One unusable graph refuses the whole answer. An anomaly says nothing in that epic may start, and
// handing out another epic's child in the same breath would report a run as proceeding normally
// while a graph a person has to look at goes unread.
function error_view(views: ReadonlyArray<EpicView>): EpicView | undefined {
	return views.find((view) => view.result.verdict === ERROR_VERDICT)
}

// The heading is added only where there is more than one epic to tell apart, so a single-epic
// invocation prints exactly the text it printed before.
function format_view(view: EpicView, is_many: boolean): string {
	const text = epic_report.format_result(view.result)

	return is_many ? `${format_reference(view.reference)}\n${text}` : text
}

function aggregate_text(views: ReadonlyArray<EpicView>): string {
	const is_many = views.length > ONE_EPIC

	return views.map((view) => format_view(view, is_many)).join(BLOCK_SEPARATOR)
}

// The running set with every issue that waits on a person taken out, and the views built from it
// (joshuafolkken/kit#1943). A blocker in another named epic only waits when that blocker itself can
// finish: one parked, or one that is itself blocked from outside, holds its dependants for a person
// exactly as a parked blocker inside one epic does. Each pass removes what the previous one sent to a
// person, so the set only shrinks, and the walk ends at the first pass that removes nothing.
function settle_views(
	running: ReadonlySet<string>,
	build: (running: ReadonlySet<string>) => ReadonlyArray<EpicView>,
): ReadonlyArray<EpicView> {
	const views = build(running)
	const stuck = new Set(
		views.flatMap((view) => view.result.blocked_on_people.map((child) => epic_graph.key_of(child))),
	)
	// Deleted in a loop: `Set#difference` is not in this project's TS lib.
	const settled = new Set(running)

	for (const key of stuck) settled.delete(key)

	return settled.size === running.size ? views : settle_views(settled, build)
}

const epic_next_views = {
	settle_views,
	format_reference,
	confirm_context,
	pools_of,
	combined_verdict,
	error_view,
	format_view,
	aggregate_text,
}

export type { EpicView }
export { epic_next_views }
