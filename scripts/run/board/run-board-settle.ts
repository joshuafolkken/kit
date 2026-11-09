import type { ItemState, ItemStatus } from './run-board-status'

// What a child keeps of its run when it settles into a state other than running — shared by the
// stream fold (`run-board-status.ts`) and a lane's stop (`run-board-lane-stop.ts`).

// The newest launch carried on, where the child launched more than once.
function relaunch_of(status: ItemStatus | undefined): Pick<ItemStatus, 'launched_ms'> {
	return status?.launched_ms === undefined ? {} : { launched_ms: status.launched_ms }
}

// What a settled child keeps of its run: its newest launch, its spans on a lane, and its track.
function kept_of(
	previous: ItemStatus | undefined,
): Pick<ItemStatus, 'launched_ms' | 'spans' | 'track'> {
	const spans = previous?.spans
	const track = previous?.track

	return {
		...relaunch_of(previous),
		...(spans !== undefined && { spans }),
		...(track !== undefined && { track }),
	}
}

// The status a child settles into: its start and the track it had reached, so a settled row still
// draws how it got there.
function settled_as(previous: ItemStatus | undefined, state: ItemState): ItemStatus {
	return { state, started_ms: previous?.started_ms, ...kept_of(previous) }
}

const run_board_settle = { relaunch_of, settled_as }

export { run_board_settle }
