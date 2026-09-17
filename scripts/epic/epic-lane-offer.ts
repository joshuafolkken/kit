import { lane_capacity } from '#scripts/lane/lane-capacity'
import { epic_busy, type BusyRead } from './epic-busy'
import {
	epic_candidate_confirm,
	type ConfirmContext,
	type RepoAnswer,
} from './epic-candidate-confirm'
import { epic_graph, type EpicChild } from './epic-graph'
import type { EpicVerdict } from './epic-report'

// Which children a repository has room to start right now (joshuafolkken/kit#1491).
//
// Until joshuafolkken/kit#1490 the answer was one or none: the contended resource was one working
// tree, so a single `in-progress` issue excluded everything else in that repository. A lane is its
// own checkout, so the question became how many are free — the repository's occupancy counted from
// GitHub, compared against `lane_capacity`'s limit.
//
// **The pool takes several sources, and none of them is an epic.** `RepoPool` is a candidate list
// with the context needed to confirm it. Since joshuafolkken/kit#1493 `epic:next` builds one per
// named epic and passes them all, which cost the caller change this design predicted and no rewrite
// of the scheduler: the signatures never learned what an epic is, because once the guarded resource
// is the lane rather than the repository, which epic a child came from stops mattering. The one
// thing several sources did add is `dedupe_pools` below — two epics can name the same child, and one
// child is one lane.

const WAIT_VERDICT: EpicVerdict = 'wait'
const RUN_VERDICT: EpicVerdict = 'run'
const NO_LANES = 0
const ONE_LANE = 1

// One source of candidates, with what confirming them needs. The context carries the graph a
// candidate is re-classified against, which is per-source by construction — two epics are two pools,
// each confirmed against its own graph.
interface RepoPool {
	candidates: ReadonlyArray<EpicChild>
	context: ConfirmContext
}

// What is being asked of one repository. `is_all_lanes` is the caller's appetite rather than the
// repository's capacity: `epic:next --repo` prints a single token unless `--lanes` was passed, so a
// caller written against the one-child contract keeps getting exactly one child.
interface LaneRequest {
	repo: string
	limit: number
	is_all_lanes: boolean
}

// The answer for one repository: the children to start, the verdict standing in their place when
// there are none, and the line explaining either. The notice goes to standard error — standard
// output carries issue numbers or a verdict and nothing else.
interface LaneOffer {
	children: ReadonlyArray<EpicChild>
	verdict: EpicVerdict
	notice: string
}

// A read that could not see the whole listing authorizes nothing, whatever its count says. Kept as a
// kind test rather than folded into the arithmetic: "I saw no holder" and "there are no holders"
// differ, and only the first one is a reason to wait.
function is_held(read: BusyRead): boolean {
	return read.kind === 'unreadable' || read.kind === 'truncated'
}

function free_lanes(read: BusyRead, limit: number): number {
	return is_held(read) ? NO_LANES : lane_capacity.free_lanes(limit, epic_busy.occupied_lanes(read))
}

function wanted_of(request: LaneRequest, free: number): number {
	return request.is_all_lanes ? free : Math.min(ONE_LANE, free)
}

// Said out loud because a run told only "wait" has nothing to go and look at, and because the
// occupancy is the number a person tunes `JOSH_LANE_LIMIT` against.
function withheld_message(repo: string): string {
	return `No runnable child in ${repo}: every candidate was withheld when its blocker relations were confirmed — the reason for each is above.`
}

function offered_notice(
	children: ReadonlyArray<EpicChild>,
	read: BusyRead,
	request: LaneRequest,
): string {
	if (children.length === NO_LANES) return withheld_message(request.repo)
	if (read.kind !== 'busy') return ''

	return epic_busy.occupancy_message(read.issues, request.repo, request.limit)
}

// Two pools that both offered nothing can disagree about why, and the answer has to be the one that
// says what a caller should do. The order is `epic_report.decide_verdict`'s own — waiting before
// stopping, because a run that stops while something is still resolving on its own gives up on an
// epic that was going to finish — rather than a second ranking invented here.
const VERDICT_PRIORITY: ReadonlyArray<EpicVerdict> = [RUN_VERDICT, WAIT_VERDICT, 'stop', 'complete']

function combine_verdicts(left: EpicVerdict, right: EpicVerdict): EpicVerdict {
	return VERDICT_PRIORITY.indexOf(left) <= VERDICT_PRIORITY.indexOf(right) ? left : right
}

// Every pool is a source of candidates **for the repository the request names**. The free-lane count
// was read for that one repository, so spending it on a child that lives somewhere else would
// allocate a lane nobody counted — the double-allocation joshuafolkken/kit#925 exists to prevent.
// Dropped rather than offered: a caller with children in two repositories asks twice, once per
// repository, exactly as `--repo` already makes it.
function candidates_in(pool: RepoPool, repo: string): RepoPool {
	return { ...pool, candidates: pool.candidates.filter((child) => child.repo === repo) }
}

// One pool's candidates, minus every one an earlier pool already carries. `seen` is mutated rather
// than rebuilt because the earlier pools' claim is what the later one is filtered against.
function unseen_candidates(pool: RepoPool, seen: Set<string>): RepoPool {
	const candidates: Array<EpicChild> = []

	for (const child of pool.candidates) {
		const key = epic_graph.key_of(child)

		if (seen.has(key)) continue
		seen.add(key)
		candidates.push(child)
	}

	return { ...pool, candidates }
}

// A child two epics both track is still one child, and entering it twice would open two lanes on one
// issue — two branches, two pull requests, and the second one merging over the first
// (joshuafolkken/kit#1493). Keyed through `epic_graph.key_of`, the one spelling of an issue's
// identity in this package: a bare number names a different issue in another repository.
//
// **The earlier pool keeps it**, and that is a decision rather than an accident of iteration order.
// The pool order is the order the epics were named, which is the only ranking a person typed. It
// also settles what happens when the first pool *withholds* the child: it stays withheld, because a
// `blocked-by` relation belongs to the issue rather than to the epic that lists it, so offering it
// from the second pool would start work the first pool's confirmation had just refused.
function dedupe_pools(pools: ReadonlyArray<RepoPool>): ReadonlyArray<RepoPool> {
	const seen = new Set<string>()

	return pools.map((pool) => unseen_candidates(pool, seen))
}

async function ask_pool(pool: RepoPool, wanted: number): Promise<RepoAnswer> {
	return await epic_candidate_confirm.answer_for_repo(pool.candidates, pool.context, wanted)
}

// The pools walked in order until the free lanes are spoken for. The confirmation walk itself is
// per-pool, so a candidate is still re-classified against its own graph; what this adds is that a
// second pool is asked only for the lanes the first one left — and is not asked at all once there
// are none, since a walk with no appetite would answer "every candidate was withheld" having
// examined none of them.
async function collect(
	pools: ReadonlyArray<RepoPool>,
	wanted: number,
): Promise<{ children: ReadonlyArray<EpicChild>; verdict: EpicVerdict }> {
	const children: Array<EpicChild> = []
	let verdict: EpicVerdict = 'complete'

	for (const pool of pools) {
		if (children.length >= wanted) break

		const answer = await ask_pool(pool, wanted - children.length)

		children.push(...answer.children)
		verdict = combine_verdicts(verdict, answer.verdict)
	}

	return { children, verdict: children.length > NO_LANES ? RUN_VERDICT : verdict }
}

// The repository is asked how full it is **before** any candidate is confirmed, for the reason
// joshuafolkken/kit#1121 records: a repository with no free lane is handed nothing, so the relations
// request that would confirm a candidate there buys an answer nobody reads — and a polling `epicrun`
// would pay it every round.
async function offer_for_repo(
	pools: ReadonlyArray<RepoPool>,
	request: LaneRequest,
): Promise<LaneOffer> {
	const read = await epic_busy.read_repository(request.repo)
	const free = free_lanes(read, request.limit)

	if (free === NO_LANES) {
		return {
			children: [],
			verdict: WAIT_VERDICT,
			notice: epic_busy.busy_reason(read, request.repo, request.limit),
		}
	}

	const for_repo = dedupe_pools(pools.map((pool) => candidates_in(pool, request.repo)))
	const answer = await collect(for_repo, wanted_of(request, free))

	return { ...answer, notice: offered_notice(answer.children, read, request) }
}

const epic_lane_offer = {
	is_held,
	free_lanes,
	wanted_of,
	combine_verdicts,
	candidates_in,
	unseen_candidates,
	dedupe_pools,
	withheld_message,
	collect,
	offer_for_repo,
}

export type { LaneOffer, LaneRequest, RepoPool }
export { epic_lane_offer }
