import { run_board_human_merge } from './run-board-human-merge'
import type { BoardPlan } from './run-board-layout'
import type { ItemStatus } from './run-board-status'

type Statuses = ReadonlyMap<number, ItemStatus>

// A `run:add --retry` settles an issue as waiting before it ever launched (`run-board-status.ts`). The
// plan, classified as `backlog:next` classifies it, is what says whether it starts next or waits: one the
// plan leaves unreached waits on something, so its status is dropped and it draws as the plan row it
// is — in the waiting section with its reason — rather than as an empty ⏳ lane (joshuafolkken/kit#7488).
function is_retry_wait(status: ItemStatus): boolean {
	return status.state === 'waiting' && status.started_ms === undefined
}

function released(unreached: ReadonlyArray<{ number: number }>, statuses: Statuses): Statuses {
	const waits = new Set(unreached.map((child) => child.number))

	return new Map(
		[...statuses].filter(([issue, status]) => !(waits.has(issue) && is_retry_wait(status))),
	)
}

// The human-merge overlay, then the retry waits the plan leaves unreached released to their plan rows.
function overlay_of(
	plan: BoardPlan,
	statuses: Statuses,
): ReturnType<typeof run_board_human_merge.overlay_of> {
	const current = run_board_human_merge.overlay_of(plan, statuses)

	return { ...current, statuses: released(current.plan.waves.unreached, current.statuses) }
}

const run_board_retry_wait = { overlay_of }

export { run_board_retry_wait }
