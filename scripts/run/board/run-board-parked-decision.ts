import { run_board_human } from './run-board-human'
import type { RowRead } from './run-board-layout-types'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#8525: a parked child waits on a person when its park event names a human stop or
// the issue carries one now — a child that parked itself through `run:park` writes a bare `#N parked`,
// so the event alone would draw it as 💤 while its `needs-decision` label says 🙋.
function is_parked_decision(number: number, status: ItemStatus, read: RowRead): boolean {
	if (status.state !== 'parked') return false

	return (
		run_board_human.is_decision(status.reason) ||
		run_board_human.is_human(read.labels.get(number) ?? [])
	)
}

const run_board_parked_decision = { is_parked_decision }

export { run_board_parked_decision }
