import { lane_capacity } from '#scripts/lane/lane-capacity'
import { epic_busy, type BusyRead } from './epic-busy'
import {
	epic_candidate_confirm,
	type ConfirmContext,
	type RepoAnswer,
} from './epic-candidate-confirm'
import { epic_graph, type EpicChild } from './epic-graph'
import { epic_label_age } from './epic-label-age'
import { epic_rank } from './epic-rank'
import type { EpicVerdict } from './epic-report'
import { epic_solo } from './epic-solo'
import { epic_solo_stale } from './epic-solo-stale'
import { epic_triage, type TriageVerdict } from './epic-triage'

// Which children a repository has room to start right now.
//
// A lane is its own checkout, so the question is how many are free — the repository's occupancy
// counted from GitHub, compared against `lane_capacity`'s limit.
//
// **The pool takes several sources, and none of them is an epic.** `RepoPool` is a candidate list
// with the context needed to confirm it. `epic:next` builds one per named epic and passes them all;
// the signatures never learn what an epic is, because once the guarded resource is the lane rather
// than the repository, which epic a child came from stops mattering. The one thing several sources
// add is `dedupe_pools` below — two epics can name the same child, and one child is one lane.

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
	verdict: EpicVerdict | TriageVerdict
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
	ages: ReadonlyMap<number, string>,
): string {
	if (children.length === NO_LANES) return withheld_message(request.repo)
	if (read.kind !== 'busy') return ''

	return epic_busy.occupancy_message(read.issues, request.repo, request.limit, ages)
}

// Each holder's label age, read only when there are holders to print — a
// timeline request per lane is paid for nothing on a read that names no one.
async function holder_ages(read: BusyRead, repo: string): Promise<ReadonlyMap<number, string>> {
	if (read.kind !== 'busy') return new Map()

	return await epic_label_age.read_ages(
		read.issues.map((issue) => issue.number),
		repo,
		new Date(),
	)
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
// allocate a lane nobody counted.
// Dropped rather than offered: a caller with children in two repositories asks twice, once per
// repository, exactly as `--repo` already makes it.
function candidates_in(pool: RepoPool, repo: string): RepoPool {
	return { ...pool, candidates: pool.candidates.filter((child) => child.repo === repo) }
}

// A pool's candidates for the repository in `epic_rank.rank` order — the ranking `backlog:next` offers
// in, counted against the pool's own graph. **Within a pool, not across
// pools**: the pool order is the order a person named the epics in, and that stays the outer key.
function ranked_in(pool: RepoPool, repo: string): RepoPool {
	const scoped = candidates_in(pool, repo)

	return { ...scoped, candidates: epic_rank.rank(scoped.candidates, pool.context.children) }
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
// issue — two branches, two pull requests, and the second one merging over the first.
// Keyed through `epic_graph.key_of`, the one spelling of an issue's
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

		// eslint-disable-next-line no-await-in-loop -- pools are asked in order until enough children are found
		const answer = await ask_pool(pool, wanted - children.length)

		children.push(...answer.children)
		verdict = combine_verdicts(verdict, answer.verdict)
	}

	return { children, verdict: children.length > NO_LANES ? RUN_VERDICT : verdict }
}

// The `run:solo` gate `backlog:next` applies, applied to a named epic's lanes too:
// the confirmed children are cut where `epic_solo.select` says, so a
// `run:solo` child never opens a lane beside another one on either path.
function solo_offer(
	answer: { children: ReadonlyArray<EpicChild>; verdict: EpicVerdict },
	read: BusyRead,
	request: LaneRequest,
	ages: ReadonlyMap<number, string>,
): LaneOffer {
	const { offered, notice = '' } = epic_solo.select(answer.children, read, request.repo)

	if (offered.length === NO_LANES && answer.children.length > NO_LANES) {
		return { children: [], verdict: WAIT_VERDICT, notice }
	}

	return { ...answer, children: offered, notice: offered_notice(offered, read, request, ages) }
}

// The repository is asked how full it is **before** any candidate is confirmed: a repository with no free lane is handed nothing, so the relations
// request that would confirm a candidate there buys an answer nobody reads — and a polling `epicrun`
// would pay it every round.
//
// **Triage is asked before even that**: an untriaged candidate withholds every
// candidate whatever the occupancy, and it needs only the labels already read. Only a `--lanes` ask
// is gated — it is the one that opens children beside each other; the single-child form starts one.
function triage_offer(pools: ReadonlyArray<RepoPool>, request: LaneRequest): LaneOffer | undefined {
	if (!request.is_all_lanes) return undefined

	const untriaged = epic_triage.untriaged(
		dedupe_pools(pools.map((pool) => candidates_in(pool, request.repo))).flatMap(
			(pool) => pool.candidates,
		),
	)

	if (untriaged.length === NO_LANES) return undefined

	return {
		children: [],
		verdict: epic_triage.TRIAGE_VERDICT,
		notice: epic_triage.message(untriaged, request.repo),
	}
}

async function offer_for_repo(
	pools: ReadonlyArray<RepoPool>,
	request: LaneRequest,
): Promise<LaneOffer> {
	const triage = triage_offer(pools, request)

	if (triage !== undefined) return triage

	const { read, notice } = await epic_solo_stale.release(
		await epic_busy.read_repository(request.repo),
		request.repo,
	)

	if (notice !== undefined) console.error(notice)

	const free = free_lanes(read, request.limit)
	const ages = await holder_ages(read, request.repo)

	if (free === NO_LANES) {
		return {
			children: [],
			verdict: WAIT_VERDICT,
			notice: epic_busy.busy_reason(read, request.repo, request.limit, ages),
		}
	}

	const for_repo = dedupe_pools(pools.map((pool) => ranked_in(pool, request.repo)))

	return solo_offer(await collect(for_repo, wanted_of(request, free)), read, request, ages)
}

const epic_lane_offer = {
	combine_verdicts,
	dedupe_pools,
	offer_for_repo,
}

export type { LaneOffer, LaneRequest, RepoPool }
export { epic_lane_offer }
