import { has_label_name, RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { lane_withdraw } from '#scripts/lane/lane-withdraw'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_stalled } from '#scripts/run/park/run-stalled'
import type { BoardRow, RowRead, RowReason } from './run-board-layout'
import type { ItemStatus } from './run-board-status'

// Why a child's park or withdraw ended it, in the ending event's own words — the reason its board row
// draws and its park note carries.

const KIND = run_event_stream.EVENT_KIND
// `#<N> parked`, `#<N> parked (<reason>)` and `#<N> waiting on #<M>` lose their leading number, so a
// waiting park does not name its issue twice.
const PARK_PREFIX = /^#\d+ (?:parked\s*)?/u
const PARENTHESES = /^\((?<inner>.*)\)$/u
// `#<N> withdrawn by <who>: <reason>` — every withdrawer `lane-withdraw.ts` names.
const WITHDRAW_PREFIX = new RegExp(
	String.raw`^#\d+ withdrawn by (?:${lane_withdraw.WITHDRAWER_NAMES.join('|')}):\s*`,
	'u',
)

// `#<N> parked (needs-decision)` reads as the reason `needs-decision`; a bare park has none.
function park_reason(event: RunEvent): string {
	const rest = event.text.replace(PARK_PREFIX, '')

	return PARENTHESES.exec(rest)?.groups?.['inner'] ?? rest
}

// A withdraw's reason after its prefix; a text in any other shape carries none.
function withdraw_reason(event: RunEvent): string {
	const rest = event.text.replace(WITHDRAW_PREFIX, '')

	return rest === event.text ? '' : rest.trim()
}

// A `run:stalled` park reads as its cause and the action that resumes it (`run-stalled.ts`); any other
// park as its reason.
function park_row_reason(issue: number, reason: string, is_backlog_live: boolean): string {
	const cause = run_stalled.cause_of(reason)

	return cause === undefined ? reason : run_stalled.row_text(issue, cause, is_backlog_live)
}

// The reason an ending event gives, `undefined` for an event that is neither a park nor a withdraw or
// that gives none.
function reason_of(event: RunEvent): string | undefined {
	if (event.kind === KIND.PARK) return park_reason(event) || undefined

	return event.kind === KIND.WITHDRAW ? withdraw_reason(event) || undefined : undefined
}

interface EndingRecord {
	reason?: string
	elapsed_ms?: number
}

// What an ending event records for its row: the reason it gives and the lane time its writer recorded
// (joshuafolkken/kit#4481), each only where the event carries it.
function recorded_of(event: RunEvent): EndingRecord {
	const reason = reason_of(event)
	const { elapsed_ms } = event

	return {
		...(reason !== undefined && { reason }),
		...(elapsed_ms !== undefined && { elapsed_ms }),
	}
}

// Label-only stalls have no event cause; the current run still selects their resume action.
function stalled_reason(number: number, is_backlog_live = false): RowReason {
	return { tail: run_stalled.row_text(number, '', is_backlog_live) }
}

const STALLED_STATES: ReadonlySet<string> = new Set(['stopped', 'parked'])

function is_stalled(status: ItemStatus, labels: ReadonlyArray<string> = []): boolean {
	return STALLED_STATES.has(status.state) && has_label_name(labels, RUN_STALLED_LABEL)
}

// Raw event reasons remain cacheable; only drawing selects an action from the current live state.
function row_reason(number: number, status: ItemStatus, read: RowRead): Pick<BoardRow, 'reason'> {
	if (status.reason !== undefined) {
		const tail = park_row_reason(number, status.reason, read.is_backlog_live === true)

		return { reason: { tail } }
	}

	return is_stalled(status, read.labels.get(number))
		? { reason: stalled_reason(number, read.is_backlog_live) }
		: {}
}

const run_board_ending_reason = {
	park_reason,
	park_row_reason,
	reason_of,
	recorded_of,
	row_reason,
	stalled_reason,
}

export { run_board_ending_reason }
