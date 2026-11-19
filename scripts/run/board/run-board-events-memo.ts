import { lane_host_gaps } from '#scripts/lane/lane-host-gaps'
import type { LaneSpan } from '#scripts/lane/lane-net-time'
import type { RunEvent } from '#scripts/run/event/run-event-stream'

// joshuafolkken/kit#4267: the board redraws every second but rereads the stream every few, and a read
// hands over a new `events` array, so a fold keyed on the array is folded once per read, not per redraw.
type EventsMemo<Value> = WeakMap<ReadonlyArray<RunEvent>, Value>

function remembered<Value>(
	memo: EventsMemo<Value>,
	events: ReadonlyArray<RunEvent>,
	fold: (events: ReadonlyArray<RunEvent>) => Value,
): Value {
	const kept = memo.get(events)

	if (kept !== undefined) return kept

	const value = fold(events)

	memo.set(events, value)

	return value
}

// joshuafolkken/kit#8135: the host's stops on a stream, folded once per events array — one memo per
// thread, shared by the board's statuses and the worker's usual times.
const GAPS: EventsMemo<ReadonlyArray<LaneSpan>> = new WeakMap()

function host_gaps(events: ReadonlyArray<RunEvent>): ReadonlyArray<LaneSpan> {
	return remembered(GAPS, events, lane_host_gaps.gaps_of)
}

const run_board_events_memo = { host_gaps, remembered }

export { run_board_events_memo }
export type { EventsMemo }
