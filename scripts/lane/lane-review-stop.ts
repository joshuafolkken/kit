import { has_label_name, NEEDS_HUMAN_REVIEW_LABEL } from '#scripts/issue/issue-labels'
import type { LaneStateRecord } from './lane-state-record'

// joshuafolkken/kit#8527: a review stop holds its lane's changes uncommitted under `in-progress` until
// a person reviews them. `needs-human-review` alone is not one: a person puts it on an issue before its
// run (docs/how-to/run-backlog.md), and `run:hold --human-review-stop` changes no label — it writes
// the lane record's `human-review` state. So a review stop is the label on an issue whose lane record
// says its lane stopped there.

// The lane state `run:hold --human-review-stop` writes. A `paused` lane is no review stop: the label
// stays on the issue for the whole run, so a lane paused for any other reason would read as one.
const REVIEW_STOP_STATE: LaneStateRecord['state'] = 'human-review'

// When each lane stopped for review stopped, by issue, from the lane records given.
function stops_of(records: ReadonlyArray<LaneStateRecord>): ReadonlyMap<number, number> {
	return new Map(
		records
			.filter((record) => record.state === REVIEW_STOP_STATE)
			.map((record) => [Number(record.issue), Date.parse(record.changed_at)]),
	)
}

// Whether issue `number` is held at a review stop: labelled `needs-human-review`, its lane stopped.
function is_review_stop(
	number: number,
	labels: ReadonlyArray<string>,
	stopped: ReadonlyMap<number, unknown> | undefined,
): boolean {
	return stopped?.has(number) === true && has_label_name(labels, NEEDS_HUMAN_REVIEW_LABEL)
}

const lane_review_stop = { is_review_stop, stops_of }

export { lane_review_stop }
