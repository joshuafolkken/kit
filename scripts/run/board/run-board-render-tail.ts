import { styleText } from 'node:util'
import { lane_stage_budget, type BudgetStage } from '#scripts/lane/lane-stage-budget'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import type { PrChecks } from '#scripts/run/event/run-event-checks'
import { run_board_earlier } from './run-board-earlier'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_labels, type TextColor } from './run-board-labels'
import { run_board_layout, type BoardRow } from './run-board-layout'
import { run_board_now, type TimedLine } from './run-board-now'
import type { Phase } from './run-board-phase'
import { run_board_render_checks } from './run-board-render-checks'
import { run_board_render_waits } from './run-board-render-waits'

// The end of a running row (joshuafolkken/kit#3769, #4043, #4292): the kind and the age of the newest
// thing the child did, the board's own length (`1°01′05″`), right-aligned to the widest any running
// row draws, so a `2°05′30″` and a `40″` end in one column. The phase's icon and how long the child has
// stood at it lead the row (`run-board-render-lead.ts`), so the event that entered the phase is not
// drawn again here. A settled or a waiting row draws none. A lane held in the core budget draws the
// check it holds in the newest activity's place (#4052), its reason and time leading the row.

const { PHASE_ICONS, span_of } = run_board_labels
const { is_live } = run_board_earlier
const { check_of, held_of } = run_board_render_waits
// A phase past twice its usual time is drawn as long, past three times as alarming.
const LONG_FACTOR = 2
const ALARM_FACTOR = 3
// The least a usual time counts as: the ledger's median for a stage of seconds (preflight, sync,
// report) is near zero, and scaled as it is it would draw a healthy few-second stage as alarming.
const USUAL_FLOOR_MINUTES = 2
const USUAL_FLOOR_MS = USUAL_FLOOR_MINUTES * MS_PER_MINUTE
const OVER_WORDS = 'over budget'

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

// A column's width: the widest span `age_of` gives any running row or earlier run's lane in this
// frame, and `0″`'s at the least, so a row with none still blanks a column's width.
function column_width(header: BoardHeader, age_of: (row: BoardRow) => number | undefined): number {
	const rows = run_board_layout.lane_rows(header.layout ?? run_board_layout.EMPTY_LAYOUT, [])
	const spans = rows.map((row) => {
		const age = is_live(row) ? age_of(row) : undefined

		return age === undefined ? 0 : span_of(age).length
	})

	return Math.max(span_of(0).length, ...spans)
}

// How long the child has stood at its phase, right-aligned to `width` and colored against the phase's
// usual time; blanks where no event said when it got there, so what follows still starts in its column.
function phase_time(row: BoardRow, header: BoardHeader, width: number): string {
	const current = is_live(row) ? current_of(row) : undefined

	if (current === undefined) return ' '.repeat(width)

	const elapsed = header.now_ms - current.since_ms
	const text = span_of(elapsed).padStart(width)

	return tinted(text, phase_color(elapsed, header.usual?.get(current.phase)))
}

// The icon of the phase a running row's end draws, `undefined` where it draws blanks — named by the
// legend, since a held row leads with 🚧 instead.
function phase_icon(row: BoardRow): string | undefined {
	const current = is_live(row) ? current_of(row) : undefined

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
	return is_live(row) && held_of(row, header) === undefined
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

function activity_age(row: BoardRow, header: BoardHeader): number | undefined {
	const newest = drawn_activity(row, header)

	return newest === undefined ? undefined : header.now_ms - newest.since_ms
}

// The newest activity as its kind's icon and its age, aged as the `💓` is; nothing where the row draws
// none.
function activity_part(row: BoardRow, header: BoardHeader): string {
	const newest = drawn_activity(row, header)

	if (newest === undefined) return ''

	const width = column_width(header, (other) => activity_age(other, header))
	const age = header.now_ms - newest.since_ms

	return run_board_header.aged(`${newest.icon} ${span_of(age).padStart(width)}`, age)
}

// Whether a row ends on a tail: a running row and an earlier run's lane only.
function is_tailed(row: BoardRow): boolean {
	return is_live(row)
}

// The lane budget each phase counts against (`lane-stage-budget.ts`); the report and a failure none.
const PHASE_BUDGETS: Partial<Record<Phase, BudgetStage>> = {
	investigate: 'plan',
	plan: 'plan',
	implement: 'implement',
	ship: 'ship',
	sync: 'ship',
	review: 'ship',
	gate: 'ship',
	commit: 'ship',
	round_two: 'ship',
	followup: 'followup',
}

function over_of(phase: Phase, elapsed_ms: number): number | undefined {
	const budget = PHASE_BUDGETS[phase]

	return budget === undefined ? undefined : lane_stage_budget.over_minutes(budget, elapsed_ms)
}

// What the running phase has run past its share of the lane budget, as `over budget +N′`
// (joshuafolkken/kit#5563) — words, not a glyph, since 🔺 is the priority cell's; none within it. The
// phase's own time is a lower bound of its stage's, and counts host sleep as the phase time beside it
// does, which `lane:breakdown` takes out.
function over_part(row: BoardRow, header: BoardHeader): Array<string> {
	const current = is_live(row) ? current_of(row) : undefined
	const over =
		current === undefined ? undefined : over_of(current.phase, header.now_ms - current.since_ms)

	return over === undefined ? [] : [`${OVER_WORDS} +${String(over)}′`]
}

// A running row's end before its budget part — the check its held lane waits to run, its pull
// request's checks in followup, or its newest activity.
function end_of(row: BoardRow, header: BoardHeader): Array<string> {
	const held = held_of(row, header)

	if (held !== undefined) return [check_of(held)]

	const checks = checks_of(row, header)

	if (checks !== undefined) return [run_board_render_checks.checks_part(checks, header.pull_link)]

	return [activity_part(row, header)]
}

// A running row's end, then what its phase ran past its budget; nothing for any other row.
function tail_of(row: BoardRow, header: BoardHeader): Array<string> {
	return is_tailed(row) ? [...end_of(row, header), ...over_part(row, header)] : []
}

// The icon a row's end draws for its newest activity, so the legend names it — none where the row
// draws its checks, its wait or the phase's own event in its place.
function activity_icon(row: BoardRow, header: BoardHeader): string | undefined {
	return drawn_activity(row, header)?.icon
}

const run_board_render_tail = {
	activity_icon,
	checks_of,
	phase_icon,
	phase_time,
	tail_of,
}

export { run_board_render_tail }
