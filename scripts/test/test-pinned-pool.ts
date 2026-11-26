// How `josh test:pinned` spreads its hunk checks over detached worktrees (joshuafolkken/kit#4706).
//
// **Two reverts in flight never share a tree**: each lane holds a tree of its own and checks its hunks
// one at a time, so a hunk's run sees only its own revert, as the serial run did. **The lanes fit the
// worker budget the run was admitted on** — at most one lane per worker, each vitest capped to its
// part of the budget — and never more than `MAX_TREES`, since each lane checks out a whole worktree.

const MAX_TREES = 4
const UNREAD_BUDGET = 1

interface LanePlan {
	lanes: number
	workers: number
}

// `budget` is the vitest workers the run may use; an unread one runs a single lane.
function lane_plan(count: number, budget: number = UNREAD_BUDGET): LanePlan {
	const lanes = Math.max(1, Math.min(count, budget, MAX_TREES))

	return { lanes, workers: Math.max(1, Math.floor(budget / lanes)) }
}

// The item indexes in the order the lanes take them: the costliest first (joshuafolkken/kit#8997), so
// the run never ends on one wide probe while the other lanes sit idle; equal costs keep their order.
function queue_order<T>(items: ReadonlyArray<T>, cost?: (item: T) => number): Array<number> {
	const indexes = items.map((_item, index) => index)
	if (cost === undefined) return indexes

	const costs = items.map((item) => cost(item))

	return indexes.toSorted((left, right) => (costs[right] ?? 0) - (costs[left] ?? 0))
}

// One lane's view of the shared queue: it takes its next item only once it is free, and notes which
// item indexes it took, in order, so its answers can be put back in the items' order.
function* lane_queue<T>(
	items: ReadonlyArray<T>,
	queue: Iterator<number>,
	took: Array<number>,
): Generator<T> {
	for (let next = queue.next(); next.done !== true; next = queue.next()) {
		took.push(next.value)
		yield items[next.value] as T
	}
}

// The lanes' answers, or the first lane's failure once every lane has ended — a failed lane never
// returns while the others still run their trees beside whatever the caller does next.
function settled<R>(outcomes: ReadonlyArray<PromiseSettledResult<R>>): Array<R> {
	const failed = outcomes.find((outcome) => outcome.status === 'rejected')
	if (failed !== undefined) throw failed.reason

	return outcomes.flatMap((outcome) => (outcome.status === 'fulfilled' ? [outcome.value] : []))
}

// What one lane took and answered: its answers are in the order it took the items.
interface LaneAnswer<R> {
	took: ReadonlyArray<number>
	answers: ReadonlyArray<R>
}

// A lane answers an item it took, or stops early (a halted run) and leaves the rest of what it took
// unanswered; the item it took but never answered is left out.
type RunLane<T, R> = (queue: Iterable<T>) => Promise<ReadonlyArray<R>>

// Runs every lane at once over one shared queue (joshuafolkken/kit#8997): a free lane takes the next
// item, so no lane waits on a share dealt to it while another lane is still busy.
async function run_lanes<T, R>(
	items: ReadonlyArray<T>,
	lanes: number,
	run_lane: RunLane<T, R>,
	cost?: (item: T) => number,
): Promise<Array<LaneAnswer<R>>> {
	const queue = queue_order(items, cost).values()
	const count = Math.max(1, Math.min(lanes, items.length))

	async function lane(): Promise<LaneAnswer<R>> {
		const took: Array<number> = []

		return { took, answers: await run_lane(lane_queue(items, queue, took)) }
	}

	return settled(await Promise.allSettled(Array.from({ length: count }, lane)))
}

// The lanes' results put back in the items' own order, whatever lane took an item and whenever it
// finished; `cost` orders the queue, costliest first.
async function run_pool<T, R>(
	items: ReadonlyArray<T>,
	lanes: number,
	run_lane: RunLane<T, R>,
	cost?: (item: T) => number,
): Promise<Array<R>> {
	const answered = await run_lanes(items, lanes, run_lane, cost)
	const placed = answered.flatMap(({ took, answers }) =>
		answers.map((answer, position): [number, R] => [took[position] ?? -1, answer]),
	)

	return placed.toSorted((left, right) => left[0] - right[0]).map(([, answer]) => answer)
}

const test_pinned_pool = { MAX_TREES, lane_plan, queue_order, run_pool }

export { test_pinned_pool }
