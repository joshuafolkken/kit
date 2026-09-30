import { has_any_label, has_label_name, RUN_SOLO_LABEL } from '#scripts/git/issue-labels'
import { issue_citation } from '#scripts/rules/issue-citation'
import { epic_busy, type BusyRead } from './epic-busy'
import type { EpicChild } from './epic-graph'
import { epic_report, type EpicNextResult } from './epic-report'

// The `run:solo` gate on what a run is offered (joshuafolkken/kit#2776).
//
// `wip-cap.md`'s run-alone section says an issue whose defect reaches the verification path runs
// alone, and until this gate that was a judgement made at dispatch — the offer handed such an issue
// out beside others and `backlog:drive` launched every number it was given. The label records the
// judgement once; this applies it to every ask, so it holds without an agent in the loop.
//
// **Both offer paths call `select`**: `backlog:next` (the pool drain, through `gate`) and
// `epic:next --lanes` (a named epic's children, `epic-lane-offer.ts`). One rule, so the two cannot
// disagree about what may start beside what.
//
// Three rules, all against the repository's `in-progress` holders (`epic_busy.read_repository`):
// a running `run:solo` issue lets nothing new start; a `run:solo` candidate starts only into an idle
// repository and then alone; and nothing ranked below a waiting `run:solo` candidate is offered past
// it, so it is not starved by the lanes it is waiting on. A listing that could not be read is not an
// idle repository — the same fail-safe answer `epic_busy` gives.
//
// **An idle repository takes its first `run:solo` candidate ahead of the ranking**
// (joshuafolkken/kit#2778). An issue carries the label because its defect reaches the verification
// path, and `wip-cap.md` resumes a batch only once that has merged — so an ordinary candidate ranked
// ahead of it would spend a whole wave running alone, then hold the fix back behind its own merge.
// While lanes are running the ranking stands: nothing overtakes a waiting `run:solo` candidate, and
// the ones ahead of it keep their lanes.

const SOLO_LABELS: ReadonlySet<string> = new Set([RUN_SOLO_LABEL])

// Which of the ordered candidates may start, which are held back, and why when a reason is worth
// saying. `offered` keeps the candidates' own order.
interface SoloSelection {
	offered: ReadonlyArray<EpicChild>
	withheld: ReadonlyArray<EpicChild>
	notice?: string
}

interface SoloGate {
	result: EpicNextResult
	notice?: string
}

function is_solo(child: EpicChild): boolean {
	return has_label_name(child.labels, RUN_SOLO_LABEL)
}

function solo_holder(read: BusyRead): number | undefined {
	if (read.kind !== 'busy') return undefined

	return read.issues.find((issue) => has_any_label(issue.labels, SOLO_LABELS))?.number
}

function held_message(holder: number, repo: string): string {
	return issue_citation.linkify(
		`#${String(holder)} carries \`${RUN_SOLO_LABEL}\` and is running in ${repo}; nothing else starts until it merges or is parked.`,
		repo,
	)
}

function waiting_message(solo: number, repo: string): string {
	return issue_citation.linkify(
		`#${String(solo)} carries \`${RUN_SOLO_LABEL}\` and waits for ${repo}'s running lanes to finish; nothing ranked below it is offered past it.`,
		repo,
	)
}

function first_of(children: ReadonlyArray<EpicChild>, keep: number): SoloSelection {
	return { offered: children.slice(0, keep), withheld: children.slice(keep) }
}

function none_of(children: ReadonlyArray<EpicChild>, notice: string): SoloSelection {
	return { offered: [], withheld: [...children], notice }
}

// The ranking with the first `run:solo` candidate moved to the head — but only into an idle
// repository, the one place it may start. Anywhere else the ranking is returned as it was.
function prefer(children: ReadonlyArray<EpicChild>, read: BusyRead): ReadonlyArray<EpicChild> {
	const solo = children.find((child) => is_solo(child))

	if (solo === undefined || read.kind !== 'idle') return children

	return [solo, ...children.filter((child) => child !== solo)]
}

// Where the first `run:solo` candidate sits decides what starts: everything when there is none, the
// candidates ahead of it when lanes are running, and it alone into an idle repository.
function select_candidates(
	children: ReadonlyArray<EpicChild>,
	read: BusyRead,
	repo: string,
): SoloSelection {
	const ordered = prefer(children, read)
	const index = ordered.findIndex((child) => is_solo(child))
	const solo = ordered[index]

	if (solo === undefined) return first_of(ordered, ordered.length)
	if (index > 0) return first_of(ordered, index)
	if (read.kind === 'idle') return first_of(ordered, 1)

	return none_of(ordered, waiting_message(solo.number, repo))
}

// An unreadable or truncated listing keeps nothing: without it a running `run:solo` issue cannot be
// ruled out.
function select(children: ReadonlyArray<EpicChild>, read: BusyRead, repo: string): SoloSelection {
	if (read.kind === 'unreadable' || read.kind === 'truncated') {
		return none_of(children, epic_busy.busy_reason(read, repo, 0))
	}

	const holder = solo_holder(read)

	if (holder !== undefined) return none_of(children, held_message(holder, repo))

	return select_candidates(children, read, repo)
}

// The offered candidates of `repo` stay; the withheld ones move to `waiting`, which is where the
// report already lists children that time alone will release.
function withhold(result: EpicNextResult, repo: string, selection: SoloSelection): EpicNextResult {
	return {
		...result,
		candidates: result.candidates.map((bundle) =>
			bundle.repo === repo ? { ...bundle, children: selection.offered } : bundle,
		),
		waiting: [...result.waiting, ...selection.withheld],
	}
}

// Only a `run` answer offers anything, so every other verdict passes through untouched.
function gate(result: EpicNextResult, read: BusyRead, repo: string): SoloGate {
	if (result.verdict !== 'run') return { result }

	const selection = select(epic_report.candidates_for_repo(result, repo), read, repo)
	const gated = withhold(result, repo, selection)

	return selection.notice === undefined
		? { result: gated }
		: { result: gated, notice: selection.notice }
}

const epic_solo = { gate, is_solo, prefer, select }

export type { SoloGate, SoloSelection }
export { epic_solo }
