import { styleText } from 'node:util'
import { lane_offline_spans, type Outage } from '#scripts/lane/lane-offline-spans'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import type { RunActivity } from './run-board-activity'
import { run_board_fit } from './run-board-fit'
import { run_board_fresh } from './run-board-fresh'
import type { RunMark } from './run-board-header-names'
import { run_board_labels } from './run-board-labels'
import type { NowLine } from './run-board-now'
import { run_board_render_slot } from './run-board-render-slot'
import { run_board_row_key } from './run-board-row-key'
import { run_board_spot } from './run-board-spot'
import { run_board_theme_defs, type Theme } from './run-board-theme-defs'

// The header's time cells (`run-board-header.ts`): the run's age over the minute an ended run ended over
// the third line's spinner and age, and the stale coloring a row's newest activity takes
// (`run-board-render-tail.ts`).

const { HEADER_ICONS, minute_of, span_of } = run_board_labels
const { cell_of } = run_board_render_slot
const { padded } = run_board_fresh
const { SECONDS_MARK, TICK } = run_board_spot
const aged_fresh = run_board_fresh.aged
// A running run whose newest event is older than this is drawn as stale, so a hang stands out; past
// twice that it is drawn as alarming.
const STALE_MINUTES = 15
const STALE_MS = STALE_MINUTES * MS_PER_MINUTE
const ALARM_FACTOR = 2
const ALARM_MS = STALE_MS * ALARM_FACTOR

// What the time cells read off the header (`BoardHeader`).
interface TimeHeader {
	now_ms: number
	started_ms: number
	ended_ms: number | undefined
	activity: Pick<RunActivity, 'last_event_ms' | 'outage' | 'is_stopped'>
	spinner: string | undefined
	form: 'screen' | 'chat'
	theme?: Theme | undefined
	is_keyed?: boolean | undefined
}

// The marks of a run that is working: they turn the spinner, and only they can go stale.
const WORKING_MARKS: ReadonlySet<RunMark> = new Set<RunMark>(['running', 'setup'])

// A part aged as a working run's quiet is: yellow once stale, red once alarming — a row's newest
// activity (`run-board-render-tail.ts`).
function aged(part: string, age_ms: number): string {
	if (age_ms > ALARM_MS) return styleText('red', part)

	return age_ms > STALE_MS ? styleText('yellow', part) : part
}

// How long ago the stream last moved. An ended run has no heartbeat to keep: one counting on would
// read as a hang.
function age_of(header: OutageHeader): number | undefined {
	const last = header.activity.last_event_ms

	if (last === undefined || header.ended_ms !== undefined) return undefined

	return header.now_ms - last
}

type OutageHeader = Pick<TimeHeader, 'now_ms' | 'ended_ms' | 'activity'>

// The outage the run's stream leaves open (joshuafolkken/kit#7895), while it says the network is down
// now. An ended or stopped run keeps its own mark, and an outage its sampler no longer sees stands for
// nothing now — either drawn on would hide a hang behind an ever-growing `📴`.
function open_outage(header: OutageHeader): Outage | undefined {
	const { outage, is_stopped } = header.activity

	if (outage === undefined || is_stopped || header.ended_ms !== undefined) return undefined

	return lane_offline_spans.is_current(outage, header.now_ms) ? outage : undefined
}

// How long the network has been down, while an outage is drawn.
function offline_age(header: OutageHeader): number | undefined {
	const outage = open_outage(header)

	return outage === undefined ? undefined : header.now_ms - outage.from_ms
}

// Whether the notice slot says the `📴` — the legend names it only then.
function is_offline(header: OutageHeader): boolean {
	return offline_age(header) !== undefined
}

// The minute an ended run ended, under the run's age. Blank while the run runs: its heartbeat and an
// outage are said in the notice slot (`run-board-standing.ts`, joshuafolkken/kit#8475).
function ended_part(header: TimeHeader): string {
	const { ended_ms } = header

	return ended_ms === undefined ? '' : `${HEADER_ICONS.ended} ${minute_of(ended_ms)}`
}

// An age in the `⏰`'s format, blank where there is none to draw — no event gave it a time.
function span_or_blank(age: number | undefined): string {
	return age === undefined ? '' : span_of(age)
}

// How long ago what the third line says happened, counted to now: an ended run's age stops at its end,
// so its last words would otherwise stay fresh on every frame after it.
function fresh_age(now: NowLine | undefined, header: TimeHeader): number | undefined {
	const age = now?.age_ms

	return age === undefined ? undefined : age + header.now_ms - (header.ended_ms ?? header.now_ms)
}

// Whether the third line's `″` is drawn as the placeholder the sweep below it is placed by
// (joshuafolkken/kit#8240, #8425): in wargames on a terminal — where a spinner is given — for a run neither stopped nor
// ended, so a run that waits keeps its heartbeat moving (joshuafolkken/kit#8404).
function is_swept(header: TimeHeader, mark: RunMark): boolean {
	if (!run_board_theme_defs.live_of(header.theme).sweep) return false

	return header.spinner !== undefined && mark !== 'stopped' && header.ended_ms === undefined
}

// The third line's time: the spinner in the `⏰`'s column — turning only while the run
// works, so a watch or an end stands blank — then its age, digits under theirs, emphasized while what
// the line says is fresh, its `″` the sweep's placeholder where the run is swept.
function now_time(
	header: TimeHeader,
	mark: RunMark,
	now: NowLine | undefined,
	width: number,
): string {
	const spinner = WORKING_MARKS.has(mark) ? header.spinner : undefined
	const icon = cell_of(spinner, run_board_fit.width_of(HEADER_ICONS.heartbeat))
	const span = span_or_blank(now?.age_ms)
	const age = is_swept(header, mark) ? span.split(SECONDS_MARK).join(TICK) : span

	return `${icon} ${padded(age, width, aged_fresh(age, fresh_age(now, header), header))}`
}

// What the third line says, emphasized while it is fresh. Where the board types rows its words are keyed
// by themselves (joshuafolkken/kit#8103), so new words type after the icon and a new age alone does not.
function now_text(now: NowLine, header: TimeHeader): string {
	const section = header.is_keyed === true ? 'now' : undefined
	const words = aged_fresh(now.text, fresh_age(now, header), header)

	return `${now.icon} ${run_board_row_key.keyed(section, now.text, words)}`
}

// A run's age over the minute an ended run ended over the third line's age: the shorter lengths are
// right-aligned to the longer, so the digits stand in one column when only one has passed ten hours.
function time_parts(header: TimeHeader, mark: RunMark, now: NowLine | undefined): Array<string> {
	const elapsed = span_of((header.ended_ms ?? header.now_ms) - header.started_ms)
	const age = span_or_blank(now?.age_ms)
	const width = Math.max(elapsed.length, age.length)

	return [
		`${HEADER_ICONS.elapsed} ${elapsed.padStart(width)}`,
		ended_part(header),
		now_time(header, mark, now, width),
	]
}

const run_board_header_time = { age_of, aged, is_offline, now_text, offline_age, time_parts }

export { run_board_header_time }
export type { OutageHeader }
