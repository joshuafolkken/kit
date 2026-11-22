import { figure_format } from '#scripts/lib/figure-format'
import { run_board_estimate } from './run-board-estimate'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import { run_board_layout, type BoardRow } from './run-board-layout'
import type { PinnedIssue } from './run-board-pinned-graphql'
import { run_board_render_icon } from './run-board-render-icon'

// joshuafolkken/kit#8607: one pinned issue as the watch panel draws it — `icon number time`. The icon
// is the one its row in the run leads with (`run-board-render-icon.ts`), ✅ once GitHub reads it
// closed, ⏳ while the run holds no row for it. The time is when it closed, else when it is foretold
// to finish: a running row's own finish, a queued child's placement (`run-board-estimate.ts`).
// joshuafolkken/kit#8625: the number is the board's own issue link (`header.link`), plain where
// the terminal draws no links or the repository is unknown.

const { STATE_ICONS } = run_board_labels
const NO_TIME = '—'

function row_of(header: BoardHeader, number: number): BoardRow | undefined {
	if (header.layout === undefined) return undefined

	return run_board_layout.rows_of(header.layout).find((row) => row.number === number)
}

function icon_of(pin: PinnedIssue, row: BoardRow | undefined): string {
	if (pin.is_closed) return STATE_ICONS.merged

	return row === undefined ? STATE_ICONS.waiting : run_board_render_icon.state_icon(row)
}

function finish_ms_of(header: BoardHeader, row: BoardRow): number | undefined {
	if (run_board_estimate.is_finish_drawn(row, header)) {
		return run_board_estimate.row_finish(row, header)?.finish_ms
	}

	return run_board_estimate.queued_finish_ms(header, row.number)
}

function moment_of(
	header: BoardHeader,
	pin: PinnedIssue,
	row: BoardRow | undefined,
): number | undefined {
	if (pin.is_closed) return pin.closed_ms

	return row === undefined ? undefined : finish_ms_of(header, row)
}

// `HH:MM` on the day of `now_ms`, `MM-DD` on another, `—` where there is no moment.
function stamp_of(now_ms: number, ms: number | undefined): string {
	if (ms === undefined) return NO_TIME

	const is_today = new Date(now_ms).toDateString() === new Date(ms).toDateString()

	return is_today ? figure_format.minute_of(ms) : figure_format.day_of(ms)
}

function watch_row(header: BoardHeader, pin: PinnedIssue): string {
	const row = row_of(header, pin.number)
	const stamp = stamp_of(header.now_ms, moment_of(header, pin, row))

	return `${icon_of(pin, row)} ${header.link(String(pin.number))} ${stamp}`
}

const run_board_watch_row = { NO_TIME, stamp_of, watch_row }

export { run_board_watch_row }
