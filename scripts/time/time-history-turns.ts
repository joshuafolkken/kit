import type { RunTimeRecord } from '#scripts/time-runtime/time-history'
import { time_parent_turns, type ParentTurnTotals } from './time-parent-turns'

// The read-back half of a recorded run's turn breakdown (joshuafolkken/kit#2003). It is the inverse
// of the runtime recorder's `contributor_field`: that writes the breakdown, this reconstructs it for a
// period report, and a record without one comes back as the same withheld totals every other
// unmeasured scope prints.
//
// **It lives on the report side, apart from the recorder.** `record_run` is what a distributed
// `followup` loads, and reconstructing parent turns needs `time_parent_turns` — a `scripts/time/`
// module. Keeping this function beside the recorder would drag that dependency into the runtime's
// static closure, which is the one thing #2003 exists to prevent. Its only caller is the period report
// (`time_period`), so it belongs here rather than in the recorder that never reads a record back.
function parent_turns_of(record: RunTimeRecord): ParentTurnTotals {
	const { by_contributor } = record

	if (by_contributor === undefined) return { ...time_parent_turns.NO_PARENT_TURNS }

	// **`round_trip_count`, not `turn_count`.** The breakdown is counted one per round trip — the
	// grouping `build_parent_turns` walks — so its counts sum to that figure, while `turn_count` is a
	// second walk that also counts a model span which issued no call. Reconstructing from the wrong
	// one gives back a record whose rows do not add up to its own total, and `contributor_row`
	// computes every share against that total.
	return { turn_count: record.round_trip_count, by_contributor, is_measured: true }
}

export { parent_turns_of }
