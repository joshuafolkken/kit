import { lane_yield } from '#scripts/lane/lane-yield'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import type { ItemState } from './run-board-status'

// The state each ending event leaves the child it names in. The one table both the `✅ done` section
// (`run-board-status.ts`) and the throughput's close time (`run-board-throughput.ts`) read, so a close
// is counted where it is drawn merged.

const KIND = run_event_stream.EVENT_KIND
const STATES: Readonly<Partial<Record<string, ItemState>>> = {
	[KIND.MERGE]: 'merged',
	// A drive-closed measurement completes its issue as a merge does (`issue-merged.ts` → `is_measured`).
	[KIND.MEASURED]: 'merged',
	[KIND.PARK]: 'parked',
	[KIND.HUMAN_REVIEW]: 'human',
	[KIND.SPLIT]: 'done',
	[KIND.STOP]: 'done',
	[KIND.WITHDRAW]: 'withdrawn',
}
const CLOSED_STATE: ItemState = 'merged'

function is_close(event: Pick<RunEvent, 'kind'>): boolean {
	return STATES[event.kind] === CLOSED_STATE
}

// joshuafolkken/kit#6886: the withdrawal `run:merge` closes a yielded lane with is no ending for its
// child — the issue goes back to the queue, to wait on the lane that now holds its file (`lane-yield.ts`).
function is_requeued(event: RunEvent): boolean {
	return lane_yield.is_yield(event)
}

const run_board_ending_states = { STATES, is_close, is_requeued }

export { run_board_ending_states }
