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

const run_board_events_memo = { remembered }

export { run_board_events_memo }
export type { EventsMemo }
