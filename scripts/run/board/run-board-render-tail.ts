import { styleText } from 'node:util'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import type { PrChecks } from '#scripts/run/event/run-event-checks'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_labels, type TextColor } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import { run_board_now, type TimedLine } from './run-board-now'
import type { Phase } from './run-board-phase'
import { run_board_render_checks } from './run-board-render-checks'
import { run_board_render_waits } from './run-board-render-waits'

// The end of a running row (joshuafolkken/kit#3769, #4043): the icon of the phase its row leads with
// and how long the child has stood at it, then ` · ` and the kind and the age of the newest thing it
// did, both the board's own length (`1°01′05″`). Each time is right-aligned to the widest its column
// draws on any running row, so a `2°05′30″` and a `40″` end in one column and every icon stands in
// one column whichever row it is on. The event that entered the phase is not drawn again after the
// phase's own time. A settled or a waiting row draws neither. A lane held in the core budget draws its
// wait in the newest activity's place, in the same columns (#4052).

const { KIND_BLANK, PHASE_ICONS, span_of } = run_board_labels
const { held_of, held_text } = run_board_render_waits
const ACTIVITY_SEPARATOR = ' · '
// A phase past twice its usual time is drawn as long, past three times as alarming.
const LONG_FACTOR = 2
const ALARM_FACTOR = 3
// The least a usual time counts as: the ledger's median for a stage of seconds (preflight, sync,
// report) is near zero, and scaled as it is it would draw a healthy few-second stage as alarming.
const USUAL_FLOOR_MINUTES = 2
const USUAL_FLOOR_MS = USUAL_FLOOR_MINUTES * MS_PER_MINUTE

interface TimedActivity {
	icon: string
	since_ms: number
}

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

// A column's width: the widest span `age_of` gives any running row in this frame, and `0″`'s at the
// least, so a row with none still blanks a column's width.
function column_width(header: BoardHeader, age_of: (row: BoardRow) => number | undefined): number {
	const spans = (header.layout?.active ?? []).map((row) => {
		const age = row.state === 'running' ? age_of(row) : undefined

		return age === undefined ? 0 : span_of(age).length
	})

	return Math.max(span_of(0).length, ...spans)
}

function phase_age(row: BoardRow, header: BoardHeader): number | undefined {
	const current = current_of(row)

	return current === undefined ? undefined : header.now_ms - current.since_ms
}

// The phase's icon and how long the child has stood at it, the time colored against the phase's usual
// time; blanks where no event said when it got there, so the activity after it still starts in its
// column.
function phase_part(row: BoardRow, header: BoardHeader): string {
	const current = current_of(row)
	const width = column_width(header, (other) => phase_age(other, header))

	if (current === undefined) return `${KIND_BLANK} ${' '.repeat(width)}`

	const elapsed = header.now_ms - current.since_ms
	const text = span_of(elapsed).padStart(width)
	const color = phase_color(elapsed, header.usual?.get(current.phase))

	return `${PHASE_ICONS[current.phase]} ${tinted(text, color)}`
}

// The icon of the phase a running row's end draws, `undefined` where it draws blanks — named by the
// legend, since a held row leads with 🚧 instead.
function phase_icon(row: BoardRow): string | undefined {
	const current = row.state === 'running' ? current_of(row) : undefined

	return current === undefined ? undefined : PHASE_ICONS[current.phase]
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

// The newest activity with when it happened, `undefined` where nothing said when.
function newest_timed(row: BoardRow, header: BoardHeader): TimedActivity | undefined {
	const newest = newest_of(row, header)
	const since_ms = newest?.since_ms

	return newest === undefined || since_ms === undefined
		? undefined
		: { icon: newest.icon, since_ms }
}

// A running row whose lane no core-budget wait holds.
function is_free(row: BoardRow, header: BoardHeader): boolean {
	return row.state === 'running' && held_of(row, header) === undefined
}

// A row in followup with its pull request's checks on the stream (joshuafolkken/kit#3770), whose end
// draws them in place of its newest activity — unless its lane is held, whose wait is drawn instead.
function checks_of(row: BoardRow, header: BoardHeader): PrChecks | undefined {
	if (!is_free(row, header) || current_of(row)?.phase !== 'followup') return undefined

	return header.activity.pr_checks?.get(row.number)
}

// The event that entered the row's phase, whose time the phase part already draws.
function is_phase_event(newest: TimedActivity, row: BoardRow): boolean {
	return newest.since_ms === current_of(row)?.since_ms
}

// The newest activity a running row's end draws: none where the row draws its checks or its wait in
// its place, nor where it is the event that entered the phase.
function drawn_activity(row: BoardRow, header: BoardHeader): TimedActivity | undefined {
	if (!is_free(row, header) || checks_of(row, header) !== undefined) return undefined

	const newest = newest_timed(row, header)

	if (newest === undefined || is_phase_event(newest, row)) return undefined

	return newest
}

// The age the activity column draws: a held lane's wait, else its newest activity's.
function activity_age(row: BoardRow, header: BoardHeader): number | undefined {
	const held = held_of(row, header)

	if (held !== undefined) return held.waited_ms

	const newest = drawn_activity(row, header)

	return newest === undefined ? undefined : header.now_ms - newest.since_ms
}

// ` · ` and the newest activity as its kind's icon and its age, aged as the `💓` is, or a held lane's
// wait; nothing where the row draws neither.
function activity_part(row: BoardRow, header: BoardHeader): string {
	const width = column_width(header, (other) => activity_age(other, header))
	const held = held_of(row, header)

	if (held !== undefined) return `${ACTIVITY_SEPARATOR}${held_text(held, width)}`

	const newest = drawn_activity(row, header)

	if (newest === undefined) return ''

	const age = header.now_ms - newest.since_ms
	const text = `${newest.icon} ${span_of(age).padStart(width)}`

	return `${ACTIVITY_SEPARATOR}${run_board_header.aged(text, age)}`
}

// A running row's end, nothing for any other; a followup row's checks follow its phase part as a part
// of their own.
function tail_of(row: BoardRow, header: BoardHeader): Array<string | undefined> {
	if (row.state !== 'running') return []

	const checks = checks_of(row, header)
	const phase = phase_part(row, header)

	if (checks !== undefined) return [phase, run_board_render_checks.checks_part(checks)]

	return [`${phase}${activity_part(row, header)}`]
}

// The icon a row's end draws for its newest activity, so the legend names it — none where the row
// draws its checks, its wait or the phase's own event in its place.
function activity_icon(row: BoardRow, header: BoardHeader): string | undefined {
	return drawn_activity(row, header)?.icon
}

const run_board_render_tail = { activity_icon, checks_of, phase_icon, tail_of }

export { run_board_render_tail }
