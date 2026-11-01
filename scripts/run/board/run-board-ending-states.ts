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

const run_board_ending_states = { STATES, is_close }

export { run_board_ending_states }
