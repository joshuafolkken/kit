import type { EpicChild } from '#scripts/epic/epic-graph'
import { issue_not_before } from '#scripts/issue/issue-not-before'
import { run_board_human_merge } from './run-board-human-merge'
import type { BoardPlan } from './run-board-layout'
import { run_board_standing_waits } from './run-board-standing-waits'
import type { ItemStatus } from './run-board-status'

type Statuses = ReadonlyMap<number, ItemStatus>

// The clock the row reasons read (`run-board-tick.ts`), so a re-queued row waits on its start date by
// the same time the start check does; absent, the wall clock.
interface RetryClock {
	now_ms?: number | undefined
}

// A `run:add --retry` settles an issue as waiting before it ever launched (`run-board-status.ts`). The
// plan, classified as `backlog:next` classifies it, is what says whether it starts next or waits: one the
// plan leaves unreached waits on something, so its status is dropped and it draws as the plan row it
// is — in the waiting section with its reason — rather than as an empty ⏳ lane (joshuafolkken/kit#7488).
// One that launched before waits as a plan row too while its start date is still ahead: no free lane
// starts it, so its 📅 date is what it waits on (joshuafolkken/kit#8084).
function is_retry_wait(status: ItemStatus, child: EpicChild, now_ms: number | undefined): boolean {
	if (status.state !== 'waiting') return false

	return (
		status.started_ms === undefined || issue_not_before.waiting_ms(child.body, now_ms) !== undefined
	)
}

// One held by an upstream Issue in another repository keeps its lane: its run stopped on the
// interrupt, so it draws as a ⏳ lane row naming the upstream Issue (joshuafolkken/kit#7695).
function released(plan: BoardPlan, statuses: Statuses): Statuses {
	const { context, waves, now_ms } = plan
	const waits = new Map(
		waves.unreached
			.filter((child) => !run_board_standing_waits.is_upstream_held(child, context))
			.map((child) => [child.number, child]),
	)

	return new Map(
		[...statuses].filter(([issue, status]) => {
			const child = waits.get(issue)

			return child === undefined || !is_retry_wait(status, child, now_ms)
		}),
	)
}

// The human-merge overlay, then the retry waits the plan leaves unreached released to their plan rows.
function overlay_of(
	plan: BoardPlan,
	statuses: Statuses,
): ReturnType<typeof run_board_human_merge.overlay_of> {
	const current = run_board_human_merge.overlay_of(plan, statuses)

	return { ...current, statuses: released(current.plan, current.statuses) }
}

const run_board_retry_wait = { overlay_of }

export { run_board_retry_wait }
export type { RetryClock }
