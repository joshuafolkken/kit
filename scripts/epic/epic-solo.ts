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

const SOLO_LABELS: ReadonlySet<string> = new Set([RUN_SOLO_LABEL])

// How many of the ordered candidates may start, and why fewer than all when a reason is worth saying.
interface SoloSelection {
	keep: number
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

// Where the first `run:solo` candidate sits decides how many stay: all of them when there is none,
// those ahead of it when it is not the head, and the head alone — only into an idle repository — when
// it is.
function select_candidates(
	children: ReadonlyArray<EpicChild>,
	read: BusyRead,
	repo: string,
): SoloSelection {
	const index = children.findIndex((child) => is_solo(child))
	const solo = children[index]

	if (solo === undefined) return { keep: children.length }
	if (index > 0) return { keep: index }
	if (read.kind === 'idle') return { keep: 1 }

	return { keep: 0, notice: waiting_message(solo.number, repo) }
}

// An unreadable or truncated listing keeps nothing: without it a running `run:solo` issue cannot be
// ruled out.
function select(children: ReadonlyArray<EpicChild>, read: BusyRead, repo: string): SoloSelection {
	if (read.kind === 'unreadable' || read.kind === 'truncated') {
		return { keep: 0, notice: epic_busy.busy_reason(read, repo, 0) }
	}

	const holder = solo_holder(read)

	if (holder !== undefined) return { keep: 0, notice: held_message(holder, repo) }

	return select_candidates(children, read, repo)
}

// Every candidate of `repo` is kept up to `keep`; the rest move to `waiting`, which is where the
// report already lists children that time alone will release.
function withhold(result: EpicNextResult, repo: string, keep: number): EpicNextResult {
	const here = epic_report.candidates_for_repo(result, repo)

	return {
		...result,
		candidates: result.candidates.map((bundle) =>
			bundle.repo === repo ? { ...bundle, children: here.slice(0, keep) } : bundle,
		),
		waiting: [...result.waiting, ...here.slice(keep)],
	}
}

// Only a `run` answer offers anything, so every other verdict passes through untouched.
function gate(result: EpicNextResult, read: BusyRead, repo: string): SoloGate {
	if (result.verdict !== 'run') return { result }

	const { keep, notice } = select(epic_report.candidates_for_repo(result, repo), read, repo)
	const gated = withhold(result, repo, keep)

	return notice === undefined ? { result: gated } : { result: gated, notice }
}

const epic_solo = { gate, is_solo, select }

export type { SoloGate, SoloSelection }
export { epic_solo }
