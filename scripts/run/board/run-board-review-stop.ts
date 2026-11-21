import { has_label_name, NEEDS_HUMAN_REVIEW_LABEL } from '#scripts/issue/issue-labels'
import { lane_paths } from '#scripts/lane/lane-paths'
import type { LaneStateRecord } from '#scripts/lane/lane-state'
import { run_board_labels } from './run-board-labels'
import type { BoardPlan, RowReason } from './run-board-layout-types'

// joshuafolkken/kit#8527: a review stop (`run:hold --human-review-stop`, then `needs-human-review`)
// holds its lane's changes uncommitted under `in-progress` until a person reviews them. Its 🙋 row —
// the run's own or a blocker outside the run — says so, with the lane the changes are in and how long
// ago it stopped where its lane state record says when. The board only reads the label; it never
// applies or removes it.

function is_review(labels: ReadonlyArray<string> | undefined): boolean {
	return labels !== undefined && has_label_name(labels, NEEDS_HUMAN_REVIEW_LABEL)
}

// The lane directory beside the repository, as `lane_paths` names it: `.kit-lanes/<N>` for `kit`.
function lane_of(number: number, repo: string): string {
	const name = repo.split('/').at(-1) ?? repo
	const root = lane_paths.default_lane_root(name)

	return lane_paths.lane_directory(root, String(number))
}

function since_note(stopped_ms: number | undefined, now_ms: number): string {
	if (stopped_ms === undefined) return ''

	return ` (stopped ${run_board_labels.span_of(now_ms - stopped_ms)} ago)`
}

// What a person does for a review stop: review the changes its lane holds.
function reason_of(number: number, plan: BoardPlan): RowReason {
	const lane = lane_of(number, plan.context.repo)
	const since = since_note(plan.review_stops?.get(number), plan.now_ms ?? Date.now())

	return { tail: `→ review the uncommitted changes in ${lane}${since}` }
}

// The review stop's reason for a row whose labels carry `needs-human-review`, else none.
function labelled_reason(
	number: number,
	labels: ReadonlyArray<string>,
	plan: BoardPlan,
): RowReason | undefined {
	return is_review(labels) ? reason_of(number, plan) : undefined
}

// A lane stopped where its record was last changed to a held state: `run:hold --human-review-stop`
// writes `human-review`, and a lane a person labelled by hand after `lane:pause` stays `paused`.
const STOPPED_STATES: ReadonlySet<LaneStateRecord['state']> = new Set(['human-review', 'paused'])

// When each stopped lane stopped, by issue, from every lane record the board already read — an
// earlier run's lane or one only a blocker names among them.
function stops_of(records: ReadonlyArray<LaneStateRecord>): ReadonlyMap<number, number> {
	return new Map(
		records
			.filter((record) => STOPPED_STATES.has(record.state))
			.map((record) => [Number(record.issue), Date.parse(record.changed_at)]),
	)
}

const run_board_review_stop = { labelled_reason, reason_of, stops_of }

export { run_board_review_stop }
