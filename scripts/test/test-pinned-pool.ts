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

// The items each lane takes, dealt round-robin so the lanes stay within one item of each other.
function deal<T>(items: ReadonlyArray<T>, lanes: number): Array<Array<T>> {
	const groups: Array<Array<T>> = Array.from({ length: lanes }, () => [])

	for (const [index, item] of items.entries()) groups[index % lanes]?.push(item)

	return groups.filter((group) => group.length > 0)
}

// The lanes' answers, or the first lane's failure once every lane has ended — a failed lane never
// returns while the others still run their trees beside whatever the caller does next.
function settled<R>(outcomes: ReadonlyArray<PromiseSettledResult<R>>): Array<R> {
	const failed = outcomes.find((outcome) => outcome.status === 'rejected')
	if (failed !== undefined) throw failed.reason

	return outcomes.flatMap((outcome) => (outcome.status === 'fulfilled' ? [outcome.value] : []))
}

// Runs every lane at once; a lane answers its own items in the order it was dealt them.
async function run_lanes<T, R>(
	items: ReadonlyArray<T>,
	lanes: number,
	run_lane: (group: ReadonlyArray<T>) => Promise<ReadonlyArray<R>>,
): Promise<Array<ReadonlyArray<R>>> {
	return settled(
		await Promise.allSettled(deal(items, lanes).map(async (group) => await run_lane(group))),
	)
}

// The one-item slice of lane `index % lanes` that holds item `index`.
function at(index: number, lanes: number): [number, number] {
	const position = Math.floor(index / lanes)

	return [position, position + 1]
}

// The lanes' results put back in the items' own order, whatever order the lanes finished in: item
// `index` sat at `floor(index / lanes)` in lane `index % lanes`.
async function run_pool<T, R>(
	items: ReadonlyArray<T>,
	lanes: number,
	run_lane: (group: ReadonlyArray<T>) => Promise<ReadonlyArray<R>>,
): Promise<Array<R>> {
	const results = await run_lanes(items, lanes, run_lane)

	return items.flatMap((_item, index) => results[index % lanes]?.slice(...at(index, lanes)) ?? [])
}

const test_pinned_pool = { MAX_TREES, deal, lane_plan, run_pool }

export { test_pinned_pool }
