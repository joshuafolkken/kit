import type { TimelineEvent } from '#scripts/epic/epic-label-age'
import { issue_human_stops } from '#scripts/issue/issue-human-stops'
import type { ConfirmationEntry } from '#scripts/notify/confirmation-ledger'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'
import { lane_stop_stats } from './lane-stop-stats'

// How long a person kept a run waiting: one row per stop `issue-human-stops.ts` leaves to a person —
// how many waits began in the period, their median, maximum and total, and how many are still
// unanswered — printed by `josh lane:stats`, so the confirmation worth removing next is ranked by the
// time it cost, not only its count (joshuafolkken/kit#7890).
//
// **Derived, not recorded**: a stop carried by a label waits from the label's `labeled` event on the
// issue timeline to its `unlabeled` event or the issue's close, whichever comes first; a label put back
// on the same issue is a wait of its own. A stop without a label waits from a confirmation's `asked_at`
// to its `answered_at` in the confirmation ledger (joshuafolkken/kit#7889). A wait with no end is
// counted under `unanswered` and kept out of the median, the maximum and the total, as `lane:stats`'s
// stop table keeps `not resumed` (`lane-stop-stats.ts`).

const COLUMNS = [
	'human wait',
	'waits',
	'wait median (min)',
	'wait max (min)',
	'wait total (min)',
	'unanswered',
] as const
const LABELED = 'labeled'
const UNLABELED = 'unlabeled'
const CLOSED = 'closed'

// One wait on a person: the stop key, when it began and, once answered, when it ended.
interface HumanWait {
	reason: string
	at: string
	answered_at?: string
}

// A `labeled` event with its label, its instant and its place in the timeline.
interface Opened {
	label: string
	at: string
	index: number
}

function wait_of(reason: string, at: string, answered_at?: string | null): HumanWait {
	return typeof answered_at === 'string' ? { reason, at, answered_at } : { reason, at }
}

function opened_of(event: TimelineEvent, index: number): Opened | undefined {
	const label = event.label?.name
	const at = event.created_at

	if (label === undefined || typeof at !== 'string' || event.event !== LABELED) return undefined

	return { label, at, index }
}

function is_end(event: TimelineEvent, label: string): boolean {
	return event.event === CLOSED || (event.event === UNLABELED && event.label?.name === label)
}

// The wait one `labeled` event opened, ended by the next `unlabeled` of the same label or the close.
function wait_from(opened: Opened, events: ReadonlyArray<TimelineEvent>): HumanWait {
	const end = events.slice(opened.index + 1).find((event) => is_end(event, opened.label))

	return wait_of(opened.label, opened.at, end?.created_at)
}

// Every wait one issue's timeline holds, in timeline order.
function label_waits(events: ReadonlyArray<TimelineEvent>): Array<HumanWait> {
	const stop_labels = issue_human_stops.labels()

	return events.flatMap((event, index) => {
		const opened = opened_of(event, index)

		return opened !== undefined && stop_labels.has(opened.label) ? [wait_from(opened, events)] : []
	})
}

function is_label_less(reason: string): boolean {
	return issue_human_stops.HUMAN_STOPS.some(
		(stop) => stop.key === reason && stop.label === undefined,
	)
}

// The confirmation ledger's waits for the stops no label carries; a labelled one is read from its label.
function confirmation_waits(entries: ReadonlyArray<ConfirmationEntry>): Array<HumanWait> {
	return entries
		.filter((entry) => is_label_less(entry.reason))
		.map((entry) => wait_of(entry.reason, entry.asked_at, entry.answered_at))
}

function wait_ms(wait: HumanWait): number | undefined {
	return wait.answered_at === undefined
		? undefined
		: Date.parse(wait.answered_at) - Date.parse(wait.at)
}

function reason_row(reason: string, waits: ReadonlyArray<HumanWait>): string {
	const of_reason = waits.filter((wait) => wait.reason === reason)
	const ended = of_reason.map((wait) => wait_ms(wait)).filter((value) => value !== undefined)

	return lane_stats.to_row([
		reason,
		String(of_reason.length),
		lane_stage_stats.cell(lane_stats.median(ended)),
		lane_stage_stats.cell(lane_stats.peak(ended)),
		lane_stage_stats.cell(lane_stop_stats.total(ended)),
		String(of_reason.length - ended.length),
	])
}

// The waits that began in `window`; one that began earlier is left out even if it ended inside.
function table(waits: ReadonlyArray<HumanWait>, window: StatsWindow): string {
	const in_window = lane_stats.in_window(waits, window)

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...issue_human_stops.HUMAN_STOPS.map((stop) => reason_row(stop.key, in_window)),
	].join('\n')
}

const lane_human_wait_stats = { confirmation_waits, label_waits, table }

export type { HumanWait }
export { lane_human_wait_stats }
