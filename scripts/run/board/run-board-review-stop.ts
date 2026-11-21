import type { EpicChild } from '#scripts/epic/epic-graph'
import { lane_paths } from '#scripts/lane/lane-paths'
import { lane_review_stop } from '#scripts/lane/lane-review-stop'
import type { LaneStateRecord } from '#scripts/lane/lane-state'
import { run_board_labels } from './run-board-labels'
import type { BoardPlan, ReviewStop, RowReason } from './run-board-layout-types'

// joshuafolkken/kit#8527: an issue held at a review stop (`lane-review-stop.ts`) keeps its lane's
// changes uncommitted under `in-progress` until a person reviews them. Its 🙋 row — the run's own or a
// blocker outside the run — says so, with the lane the changes are in and how long ago it stopped. The
// board only reads the label; it never applies or removes it.

// Each stopped lane of the repository, by issue: when it stopped and its directory under the lane
// root `lane:open` uses (`JOSH_LANE_ROOT`, else `.kit-lanes` beside `main_root`, the main work tree).
function stops_here(
	records: ReadonlyArray<LaneStateRecord>,
	main_root: string,
): ReadonlyMap<number, ReviewStop> {
	const root = lane_paths.lane_root(main_root)
	const stops = [...lane_review_stop.stops_of(records)]

	return new Map(
		stops.map(([number, stopped_ms]) => [
			number,
			{ stopped_ms, directory: lane_paths.lane_directory(root, String(number)) },
		]),
	)
}

function is_stopped(child: Pick<EpicChild, 'labels' | 'number'>, plan: BoardPlan): boolean {
	return lane_review_stop.is_review_stop(child.number, child.labels, plan.review_stops)
}

// What a person does for a review stop: review the changes its lane holds; none for any other row.
function reason_of(
	child: Pick<EpicChild, 'labels' | 'number'>,
	plan: BoardPlan,
): RowReason | undefined {
	const stop = plan.review_stops?.get(child.number)
	if (stop === undefined || !is_stopped(child, plan)) return undefined
	const since = run_board_labels.span_of((plan.now_ms ?? Date.now()) - stop.stopped_ms)

	return { tail: `→ review the uncommitted changes in ${stop.directory} (stopped ${since} ago)` }
}

const run_board_review_stop = { is_stopped, reason_of, stops_here }

export { run_board_review_stop }
