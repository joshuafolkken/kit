import { backlog_drive_restore } from '#scripts/backlog/backlog-drive-restore'
import { issue_cite } from '#scripts/issue/issue-cite'
import { lane_withdraw } from '#scripts/lane/lane-withdraw'
import { run_board_ending_reason } from '#scripts/run/board/run-board-ending-reason'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'

// `josh run:add --retry --withdrawn` — every issue a person withdrew from the live run and nobody
// launched again (joshuafolkken/kit#8619), each line carrying the withdrawal's reason so a withdrawal
// that should stay out (a replacement Issue, …) is seen before the next lane starts it.

const NO_WITHDRAWN_MESSAGE = 'No withdrawn issue in this backlogrun; nothing was added.'

function latest_withdrawal(events: ReadonlyArray<RunEvent>, issue: number): RunEvent | undefined {
	const subject = `${issue_cite.plain_for('program', issue)} `

	return events
		.filter((event) => event.kind === run_event_stream.EVENT_KIND.WITHDRAW)
		.findLast((event) => event.text.startsWith(subject))
}

function is_by_person(events: ReadonlyArray<RunEvent>, issue: number): boolean {
	return latest_withdrawal(events, issue)?.text.includes(lane_withdraw.PERSON_MARK) === true
}

// `withdrawn_issues` already leaves out a yield and an issue re-admitted or relaunched since; a closed
// issue the supervisor or the merge driver withdrew is no person's, and a repeated withdrawal of one
// issue names it once.
function targets(events: ReadonlyArray<RunEvent>): ReadonlyArray<number> {
	const issues = new Set(backlog_drive_restore.withdrawn_issues(events).map(Number))

	return [...issues].filter((issue) => is_by_person(events, issue))
}

// The latest withdrawal's reason, after its `#<N> withdrawn by <who>:` prefix.
function reason_of(events: ReadonlyArray<RunEvent>, issue: number): string | undefined {
	const withdrawal = latest_withdrawal(events, issue)

	return withdrawal === undefined ? undefined : run_board_ending_reason.reason_of(withdrawal)
}

// The tail each `queued` / `refused` line of a withdrawn issue ends with.
function suffix_of(events: ReadonlyArray<RunEvent>, issue: number): string {
	const reason = reason_of(events, issue)

	return reason === undefined ? ' · withdrawn' : ` · withdrawn: ${reason}`
}

const run_add_withdrawn = { NO_WITHDRAWN_MESSAGE, suffix_of, targets }

export { run_add_withdrawn }
