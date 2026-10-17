import { styleText } from 'node:util'
import { backlog_budget } from '#scripts/backlog/backlog-budget'
import type { PrChecks } from '#scripts/run/event/run-event-checks'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_labels, type TextColor } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import { run_board_now, type TimedLine } from './run-board-now'
import type { Phase } from './run-board-phase'
import { run_board_render_checks } from './run-board-render-checks'

// The end of a running row (joshuafolkken/kit#3769): how long the child has stood at the phase its row
// leads with, then the kind and the age of the newest thing it did, both the board's own length
// (`1°01′05″`). The phase's time is right-aligned to the widest any
// running row draws, so a `2°05′30″` and a `40″` end in one column and the age after them
// starts in one column whichever row it is on — where the phase track before them grew with every
// round. A settled or a waiting row draws neither.

const { NOW_ICONS, span_of } = run_board_labels
// A phase past twice its usual time is drawn as long, past three times as alarming.
const LONG_FACTOR = 2
const ALARM_FACTOR = 3
// The least a usual time counts as: the ledger's median for a stage of seconds (preflight, sync,
// report) is near zero, and scaled as it is it would draw a healthy few-second stage as alarming.
const USUAL_FLOOR_MINUTES = 2
const USUAL_FLOOR_MS = USUAL_FLOOR_MINUTES * backlog_budget.MS_PER_MINUTE

function phase_color(elapsed_ms: number, usual_ms: number | undefined): TextColor | undefined {
	if (usual_ms === undefined) return undefined
	const usual = Math.max(usual_ms, USUAL_FLOOR_MS)

	if (elapsed_ms <= usual * LONG_FACTOR) return undefined

	return elapsed_ms > usual * ALARM_FACTOR ? 'red' : 'yellow'
}

function tinted(text: string, color: TextColor | undefined): string {
	return color === undefined ? text : styleText(color, text)
}

// The phase the row leads with and when the child got there, `undefined` where no event said when.
function current_of(row: BoardRow): { phase: Phase; since_ms: number } | undefined {
	const { track = [], phase_ms } = row.status ?? {}
	const phase = track.at(-1)

	return phase === undefined || phase_ms === undefined ? undefined : { phase, since_ms: phase_ms }
}

// The phase column's width: the widest phase time any running row draws in this frame, and `0″`'s
// at the least, so a row with none still blanks a column's width.
function phase_width(header: BoardHeader): number {
	const spans = (header.layout?.active ?? []).map((row) => {
		const current = row.state === 'running' ? current_of(row) : undefined

		return current === undefined ? 0 : span_of(header.now_ms - current.since_ms).length
	})

	return Math.max(span_of(0).length, ...spans)
}

// How long the child has stood at its phase, colored against the phase's usual time; blanks where no
// event said when it got there, so the age after it still starts in its column.
function phase_part(row: BoardRow, header: BoardHeader): string {
	const current = current_of(row)
	const width = phase_width(header)

	if (current === undefined) return ' '.repeat(width)

	const elapsed = header.now_ms - current.since_ms
	const text = span_of(elapsed).padStart(width)

	return tinted(text, phase_color(elapsed, header.usual?.get(current.phase)))
}

// The newer of the child's newest operation and its newest event, read as the header's third line
// reads it, so the two never disagree on what is newest.
function newest_of(row: BoardRow, header: BoardHeader): TimedLine | undefined {
	return run_board_now.newest_of({
		operations: header.operations,
		lane_events: header.activity.lane_events,
		children: new Set([row.number]),
	})
}

// The newest activity as its kind's icon and its age, aged as the `💓` is.
function activity_part(row: BoardRow, header: BoardHeader): string | undefined {
	const newest = newest_of(row, header)

	if (newest?.since_ms === undefined) return undefined

	const age = header.now_ms - newest.since_ms

	return run_board_header.aged(`${newest.icon} ${span_of(age)}`, age)
}

// A row in followup with its pull request's checks on the stream (joshuafolkken/kit#3770), whose end
// draws them in place of its newest activity.
function checks_of(row: BoardRow, header: BoardHeader): PrChecks | undefined {
	if (row.state !== 'running' || current_of(row)?.phase !== 'followup') return undefined

	return header.activity.pr_checks?.get(row.number)
}

// A running row's end, nothing for any other.
function tail_of(row: BoardRow, header: BoardHeader): Array<string | undefined> {
	if (row.state !== 'running') return []

	const checks = checks_of(row, header)
	const last =
		checks === undefined ? activity_part(row, header) : run_board_render_checks.checks_part(checks)

	return [phase_part(row, header), last]
}

// Whether a row draws its pull request's checks, so the legend names them.
function is_checks_drawn(row: BoardRow, header: BoardHeader): boolean {
	return checks_of(row, header) !== undefined
}

// Whether a row draws the operation's icon, so the legend names it.
function is_operation_drawn(row: BoardRow, header: BoardHeader): boolean {
	if (row.state !== 'running' || is_checks_drawn(row, header)) return false

	return newest_of(row, header)?.icon === NOW_ICONS.operation
}

const run_board_render_tail = { is_checks_drawn, is_operation_drawn, tail_of }

export { run_board_render_tail }
