import { has_label_name, NEEDS_HUMAN_REVIEW_LABEL } from '#scripts/issue/issue-labels'
import { run_board_human } from './run-board-human'
import type { RowRead } from './run-board-layout-types'
import type { ItemStatus } from './run-board-status'

// Whether the issue carries a stop waiting on a person now. `needs-human-review` is drawn from the lane
// record while the lane stands (`run_board_human.DRAWN_ELSEWHERE`); a parked or withdrawn child has no
// such record left, so its label is read here (joshuafolkken/kit#8578).
function waits_on_person(number: number, read: RowRead): boolean {
	const labels = read.labels.get(number) ?? []

	return run_board_human.is_human(labels) || has_label_name(labels, NEEDS_HUMAN_REVIEW_LABEL)
}

// joshuafolkken/kit#8525: a parked child waits on a person when its park event names a human stop or
// the issue carries one now — a child that parked itself through `run:park` writes a bare `#N parked`,
// so the event alone would draw it as 💤 while its `needs-decision` label says 🙋.
// joshuafolkken/kit#8578: a child withdrawn after its park still waits on a person while its issue is
// open (no `outcome`) and carries the label; a closed one, or one whose label was removed, ends.
function is_parked_decision(number: number, status: ItemStatus, read: RowRead): boolean {
	if (status.state === 'withdrawn') {
		return status.outcome === undefined && waits_on_person(number, read)
	}

	if (status.state !== 'parked') return false

	return run_board_human.is_decision(status.reason) || waits_on_person(number, read)
}

const run_board_parked_decision = { is_parked_decision }

export { run_board_parked_decision }
