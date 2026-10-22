import { backlog_drive_named } from '#scripts/backlog/backlog-drive-named'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_board_labels } from './run-board-labels'
import { run_board_layout, type RowReason } from './run-board-layout'
import type { ReasonRead } from './run-board-reason'
import { run_board_setup } from './run-board-setup'

// The queued row the run's planning is for (joshuafolkken/kit#4279): while the run stands at its
// `planning` stage, the one issue it launches next leads with 📝 and says how long it has planned, and
// no other row does. That issue is the driver's own next in a named run (`backlog-drive-named.ts`), else
// the plan's first waiting row — the head of its first wave. No event says it; the stage and the order do.

const { STAGE } = run_event_setup
const FIRST = 0
const PLANNING_ICON = run_board_labels.STAGE_ICONS[STAGE.PLANNING]

interface Planning {
	issue: number
	reason: RowReason
}

function named_next(read: ReasonRead, in_flight: ReadonlyArray<number>): number | undefined {
	if (read.carry === undefined) return undefined

	return backlog_drive_named.next_of(read.carry, in_flight.map(String))
}

function next_launch(read: ReasonRead, in_flight: ReadonlyArray<number>): number | undefined {
	return named_next(read, in_flight) ?? run_board_layout.waiting_children(read)[FIRST]?.number
}

function planning_of(read: ReasonRead, in_flight: ReadonlyArray<number>): Planning | undefined {
	const { setup, setup_ms } = run_board_setup.read(read.events)
	if (read.is_stopped || setup !== STAGE.PLANNING) return undefined
	const issue = next_launch(read, in_flight)

	return issue === undefined
		? undefined
		: { issue, reason: { icon: PLANNING_ICON, since_ms: setup_ms } }
}

const run_board_planning = { planning_of }

export { run_board_planning }
export type { Planning }
