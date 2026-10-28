import type { BusyRead } from '#scripts/epic/epic-busy'
import { epic_graph, type EpicChild } from '#scripts/epic/epic-graph'
import { epic_rank } from '#scripts/epic/epic-rank'
import type { EpicNextResult } from '#scripts/epic/epic-report'
import { epic_solo, type SoloGate, type SoloSelection } from '#scripts/epic/epic-solo'
import { git_next_issues } from '#scripts/issue/git-next-issues'
import type { LaneRecords } from '#scripts/lane/lane-state'
import { backlog_overlap, type Declared } from './backlog-overlap'

// What the backlog offers, in the order it is decided: rank, then the
// `run:solo` gate, then the cap. `backlog:next` and `backlog:plan --waves` both call `select`, so the
// plan's first wave is what the run starts into an idle repository rather than an order the run never
// takes. Only the cap's width differs: `backlog:next` prints `DISPLAY_LIMIT` rows, a wave holds the
// lane limit (`limit`).
//
// **The cap comes last.** Applied while the standalone half is classified, before the gate, it would
// cut a `run:solo` issue ranked sixth or lower before the gate could see it — and offer the issues
// below it past it. Cut after the gate, the cap only ever removes what the gate would have offered,
// so it cannot hide a waiting `run:solo` issue from it. It bounds only the standalone rows; an epic's
// children are never capped.

// Every child the classification placed, in the order it placed them: the ranked candidates first,
// then the waiting ones, then the ones waiting on a person.
function everything_in(result: EpicNextResult): ReadonlyArray<EpicChild> {
	const candidates = result.candidates.flatMap((bundle) => bundle.children)

	return [...candidates, ...result.waiting, ...result.blocked_on_people]
}

// The ranking is `epic_rank.rank`, shared with a named epic's lanes.
const { rank } = epic_rank

// This repository's candidates put in `order` inside the result; another repository's are left as
// they came.
function reorder_repo(
	result: EpicNextResult,
	repo: string,
	order: (children: ReadonlyArray<EpicChild>) => ReadonlyArray<EpicChild>,
): EpicNextResult {
	if (result.verdict !== 'run') return result

	return {
		...result,
		candidates: result.candidates.map((bundle) =>
			bundle.repo === repo ? { ...bundle, children: order(bundle.children) } : bundle,
		),
	}
}

// The rank `select` starts from; `offer_order` adds the yielded-first step for `backlog:plan`.
function rank_result(result: EpicNextResult, repo: string): EpicNextResult {
	const pool = everything_in(result)

	return reorder_repo(result, repo, (children) => rank(children, pool))
}

// The standalone rows past the cap, in offer order.
function overflow_of(
	offered: ReadonlyArray<EpicChild>,
	standalone: ReadonlySet<string>,
	limit: number,
): ReadonlySet<string> {
	const keys = offered.map((child) => epic_graph.key_of(child)).filter((key) => standalone.has(key))

	return new Set(keys.slice(limit))
}

function is_in(child: EpicChild, keys: ReadonlySet<string>): boolean {
	return keys.has(epic_graph.key_of(child))
}

function cap(
	selection: SoloSelection,
	standalone: ReadonlySet<string>,
	limit: number,
): SoloSelection {
	const overflow = overflow_of(selection.offered, standalone, limit)

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
	// The paths each issue declares; two candidates whose paths overlap are not offered together.
	// Absent, nothing is separated.
	declared?: Declared
	// The issues' lane state records; a clash with a paused holder says so. Absent, none is named.
	lanes?: LaneRecords
	// The keys of the issues that gave their lane back (`lane-yield.ts`). Absent, none did.
	yielded?: ReadonlySet<string>
	// How many standalone rows the cap keeps. Absent, `DISPLAY_LIMIT` — what `backlog:next` prints.
	limit?: number
}

// A yielded issue ahead of the rank: its lane was taken from it, so it takes the first free one
// once its holder ends rather than queueing behind the pool (joshuafolkken/kit#5107). While the
// holder runs, its kept plan still withholds it in the separation. It goes ahead of a `run:solo`
// issue too: the solo gate sees it first.
function yielded_first(
	ranked: ReadonlyArray<EpicChild>,
	yielded: ReadonlySet<string>,
): Array<EpicChild> {
	return [
		...ranked.filter((child) => is_in(child, yielded)),
		...ranked.filter((child) => !is_in(child, yielded)),
	]
}

// A ranked result in the order `select` walks it — a yielded issue ahead of the rank — so
// `backlog:plan`'s "Ready now" reads in the order each wave is offered in (joshuafolkken/kit#5299).
function offer_order(
	result: EpicNextResult,
	repo: string,
	yielded: ReadonlySet<string> = new Set(),
): EpicNextResult {
	return reorder_repo(result, repo, (children) => yielded_first(children, yielded))
}

// The overlap separation runs before the cap, for the reason the gate does: the cap only ever
// removes what would otherwise be offered.
function select(input: OfferInput): SoloSelection {
	const ranked = yielded_first(rank(input.candidates, input.pool), input.yielded ?? new Set())
	const { read, repo, lanes } = input
	const gated = epic_solo.select(ranked, read, repo)
	const separated = backlog_overlap.separate(gated, input.declared ?? new Map(), {
		read,
		repo,
		lanes,
	})

	return cap(separated, input.standalone, input.limit ?? git_next_issues.DISPLAY_LIMIT)
}

interface GateScope {
	standalone: ReadonlySet<string>
	declared: Declared
	lanes?: LaneRecords
	yielded?: ReadonlySet<string>
	// How many standalone rows a planned wave holds — the lane limit; `backlog:next`'s offer ignores
	// it. Absent, a wave is not capped (joshuafolkken/kit#5300).
	wave_limit?: number | undefined
}

// `backlog:next`'s gate: `epic_solo.gate` with this selection in place of its bare one.
function gate(result: EpicNextResult, read: BusyRead, repo: string, scope: GateScope): SoloGate {
	const pool = everything_in(result)

	return epic_solo.gate(result, read, repo, (candidates) =>
		select({ candidates, pool, read, repo, ...scope }),
	)
}

const backlog_rank = { everything_in, gate, offer_order, rank_result, select }

export { backlog_rank }
export type { GateScope, OfferInput }
