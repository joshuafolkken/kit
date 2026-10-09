import { issue_cite } from '#scripts/issue/issue-cite'
import { has_any_label, has_label_name, RUN_SOLO_LABEL } from '#scripts/issue/issue-labels'
import { issue_citation } from '#scripts/rules/issue-citation'
import { epic_busy, type BusyRead } from './epic-busy'
import type { EpicChild } from './epic-graph'
import { epic_report, type EpicNextResult } from './epic-report'

// The `run:solo` gate on what a run is offered.
//
// `backlogrun-lanes.md`'s run-alone rule says an issue whose defect reaches the verification path runs
// alone, and until this gate that was a judgement made at dispatch — the offer handed such an issue
// out beside others and `backlog:drive` launched every number it was given. The label records the
// judgement once; this applies it to every ask, so it holds without an agent in the loop.
//
// **Both offer paths call `select`**: `backlog:next` (the pool drain, through `gate`) and
// `epic:next --lanes` (a named epic's children, `epic-lane-offer.ts`). One rule, so the two cannot
// disagree about what may start beside what.
//
// Three rules, all against the repository's `in-progress` holders (`epic_busy.read_repository`, with
// a stale `run:solo` holder taken out by `epic_solo_stale.release`):
// a running `run:solo` issue lets nothing new start; a `run:solo` candidate starts only into an idle
// repository and then alone; and nothing ranked below a waiting `run:solo` candidate is offered past
// it, so it is not starved by the lanes it is waiting on. A listing that could not be read is not an
// idle repository — the same fail-safe answer `epic_busy` gives.
//
// **The label does not move a candidate up the ranking**. `run:solo` means "runs alone", and tidying
// that merely touches the verification path carries it as well as a defect that breaks it. Which of
// them goes first is the ranking's question — `issue-rank.ts` puts a verification-path defect at the head — so an idle
// repository takes the candidates in rank order like any other.

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
		`${issue_cite.plain(holder)} carries \`${RUN_SOLO_LABEL}\` and is running in ${repo}; nothing else starts until it merges or is parked.`,
		repo,
	)
}

function waiting_message(solo: number, repo: string): string {
	return issue_citation.linkify(
		`${issue_cite.plain(solo)} carries \`${RUN_SOLO_LABEL}\` and waits for ${repo}'s running lanes to finish; nothing ranked below it is offered past it.`,
		repo,
	)
}

function first_of(children: ReadonlyArray<EpicChild>, keep: number): SoloSelection {
	return { offered: children.slice(0, keep), withheld: children.slice(keep) }
}

function none_of(children: ReadonlyArray<EpicChild>, notice: string): SoloSelection {
	return { offered: [], withheld: [...children], notice }
}

// Where the first `run:solo` candidate sits decides what starts: everything when there is none, the
// candidates ahead of it when it is not first, and it alone once it heads an idle repository's ranking.
function select_candidates(
	children: ReadonlyArray<EpicChild>,
	read: BusyRead,
	repo: string,
): SoloSelection {
	const index = children.findIndex((child) => is_solo(child))
	const solo = children[index]

	if (solo === undefined) return first_of(children, children.length)
	if (index > 0) return first_of(children, index)
	if (read.kind === 'idle') return first_of(children, 1)

	return none_of(children, waiting_message(solo.number, repo))
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

// What decides the selection. `select` by default; `backlog:next` passes one that ranks before it and
// caps after it (`backlog-rank.ts`), so the gate itself is written once.
type SoloSelector = (
	children: ReadonlyArray<EpicChild>,
	read: BusyRead,
	repo: string,
) => SoloSelection

// Only a `run` answer offers anything, so every other verdict passes through untouched.
function gate(
	result: EpicNextResult,
	read: BusyRead,
	repo: string,
	selector: SoloSelector = select,
): SoloGate {
	if (result.verdict !== 'run') return { result }

	const selection = selector(epic_report.candidates_for_repo(result, repo), read, repo)
	const gated = withhold(result, repo, selection)

	return selection.notice === undefined
		? { result: gated }
		: { result: gated, notice: selection.notice }
}

const epic_solo = { gate, is_solo, select }

export type { SoloGate, SoloSelection, SoloSelector }
export { epic_solo }
