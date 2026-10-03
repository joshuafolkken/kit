import type { BusyRead } from '#scripts/epic/epic-busy'
import { epic_graph, type EpicChild } from '#scripts/epic/epic-graph'
import { epic_rank } from '#scripts/epic/epic-rank'
import type { EpicNextResult } from '#scripts/epic/epic-report'
import { epic_solo, type SoloGate, type SoloSelection } from '#scripts/epic/epic-solo'
import { git_next_issues } from '#scripts/issue/git-next-issues'

// What the backlog offers, in the order it is decided (joshuafolkken/kit#2928): rank, then the
// `run:solo` gate, then the cap. `backlog:next` and `backlog:plan --waves` both call `select`, so the
// plan's first wave is what the run starts into an idle repository rather than an order the run never
// takes.
//
// **The cap comes last.** It used to be applied while the standalone half was classified, before the
// gate, so a `run:solo` issue ranked sixth or lower was cut before the gate could see it — and the
// issues below it were offered past it. Cut after the gate, the cap only ever removes what the gate
// would have offered, so it cannot hide a waiting `run:solo` issue from it. It still bounds only the
// standalone rows, as it always has; an epic's children were never capped.

// Every child the classification placed, in the order it placed them: the ranked candidates first,
// then the waiting ones, then the ones waiting on a person.
function everything_in(result: EpicNextResult): ReadonlyArray<EpicChild> {
	const candidates = result.candidates.flatMap((bundle) => bundle.children)

	return [...candidates, ...result.waiting, ...result.blocked_on_people]
}

// The ranking is `epic_rank.rank`, shared with a named epic's lanes.
const { rank } = epic_rank

// This repository's candidates re-ranked inside the result, so `backlog:plan` prints the order the
// offer is decided in.
function rank_result(result: EpicNextResult, repo: string): EpicNextResult {
	if (result.verdict !== 'run') return result

	const pool = everything_in(result)

	return {
		...result,
		candidates: result.candidates.map((bundle) =>
			bundle.repo === repo ? { ...bundle, children: rank(bundle.children, pool) } : bundle,
		),
	}
}

// The standalone rows past the cap, in offer order.
function overflow_of(
	offered: ReadonlyArray<EpicChild>,
	standalone: ReadonlySet<string>,
): ReadonlySet<string> {
	const keys = offered.map((child) => epic_graph.key_of(child)).filter((key) => standalone.has(key))

	return new Set(keys.slice(git_next_issues.DISPLAY_LIMIT))
}

function is_in(child: EpicChild, keys: ReadonlySet<string>): boolean {
	return keys.has(epic_graph.key_of(child))
}

function cap(selection: SoloSelection, standalone: ReadonlySet<string>): SoloSelection {
	const overflow = overflow_of(selection.offered, standalone)

	if (overflow.size === 0) return selection

	return {
		...selection,
		offered: selection.offered.filter((child) => !is_in(child, overflow)),
		withheld: [
			...selection.offered.filter((child) => is_in(child, overflow)),
			...selection.withheld,
		],
	}
}

interface OfferInput {
	candidates: ReadonlyArray<EpicChild>
	pool: ReadonlyArray<EpicChild>
	read: BusyRead
	repo: string
	// The keys of the standalone rows — the ones the cap bounds.
	standalone: ReadonlySet<string>
}

function select(input: OfferInput): SoloSelection {
	const ranked = rank(input.candidates, input.pool)

	return cap(epic_solo.select(ranked, input.read, input.repo), input.standalone)
}

// `backlog:next`'s gate: `epic_solo.gate` with this selection in place of its bare one.
function gate(
	result: EpicNextResult,
	read: BusyRead,
	repo: string,
	standalone: ReadonlySet<string>,
): SoloGate {
	const pool = everything_in(result)

	return epic_solo.gate(result, read, repo, (candidates) =>
		select({ candidates, pool, read, repo, standalone }),
	)
}

const backlog_rank = { everything_in, gate, rank_result, select }

export { backlog_rank }
export type { OfferInput }
