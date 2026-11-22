import { backlog_drive_restore } from '#scripts/backlog/backlog-drive-restore'
import { issue_cite } from '#scripts/issue/issue-cite'
import { run_board_ending_reason } from '#scripts/run/board/run-board-ending-reason'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'

// `josh run:add --retry --withdrawn` — every issue a person withdrew from the live run and nobody
// launched again (joshuafolkken/kit#8619), each line carrying the withdrawal's reason so a withdrawal
// that should stay out (a replacement Issue, …) is seen before the next lane starts it.

const NO_WITHDRAWN_MESSAGE = 'No withdrawn issue in this backlogrun; nothing was added.'

// A yield and an issue re-admitted or relaunched since are left out by `withdrawn_issues` itself.
function targets(events: ReadonlyArray<RunEvent>): ReadonlyArray<number> {
	return backlog_drive_restore.withdrawn_issues(events).map(Number)
}

// The latest withdrawal's reason, after its `#<N> withdrawn by <who>:` prefix.
function reason_of(events: ReadonlyArray<RunEvent>, issue: number): string | undefined {
	const subject = `${issue_cite.plain_for('program', issue)} `
	const withdrawal = events
		.filter((event) => event.kind === run_event_stream.EVENT_KIND.WITHDRAW)
		.findLast((event) => event.text.startsWith(subject))

	return withdrawal === undefined ? undefined : run_board_ending_reason.reason_of(withdrawal)
}

// The tail each `queued` / `refused` line of a withdrawn issue ends with.
function suffix_of(events: ReadonlyArray<RunEvent>, issue: number): string {
	const reason = reason_of(events, issue)

	return reason === undefined ? ' · withdrawn' : ` · withdrawn: ${reason}`
}

const run_add_withdrawn = { NO_WITHDRAWN_MESSAGE, suffix_of, targets }

export { run_add_withdrawn }
