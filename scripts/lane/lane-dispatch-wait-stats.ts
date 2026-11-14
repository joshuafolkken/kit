import { backlog_hold_codes } from '#scripts/backlog/backlog-hold-codes'
import { backlog_next_report } from '#scripts/backlog/backlog-next-report'
import { issue_cite } from '#scripts/issue/issue-cite'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_event_filed } from '#scripts/run/event/run-event-filed'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { lane_ledger, type DispatchEntry, type LedgerEntry } from './lane-ledger'
import type { OfferEntry } from './lane-ledger-schema-offer'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'

// How long an issue ready to start waited for its dispatch (joshuafolkken/kit#7508): the owner's bound
// is one minute from the moment it became runnable, and #7503's overrun was found only by matching logs
// by hand. Printed by `josh lane:stats` as one row: the period's dispatches, the median and longest
// wait, and how many passed the bound.
//
// **The wait starts at the runnable stretch the dispatch ended**: the offers since the issue's previous
// dispatch, from the first one that saw it and held nothing back on it — or, when the issue was filed
// after the last offer that could not start it, at that filing (the `filed` run event), since an offer
// only reads it at the next pass. A dispatch no offer saw (a ledger from before `offer` entries, or a
// lane opened by hand) is counted under `not measured`.
//
// **A seat that was not there is not waiting**: a hold by memory, a usage limit or the `run:solo` gate,
// and the time after a `released` entry (every lane taken, or the run finished), each lasting until the
// next `held`, `released` or `dispatch` entry as `lane-held-stats.ts` tiles them, are taken out.

const { KIND } = lane_ledger
const { MEMORY_REASON, REASON_SEPARATOR, USAGE_LIMIT_REASON } = backlog_hold_codes
const { NOT_MEASURED, is_dispatch } = lane_stage_stats
const RETRY_VERDICT = backlog_next_report.VERDICT_TOKENS.retry
const LIMIT_MS = MS_PER_MINUTE
const SEATLESS_REASONS: ReadonlySet<string> = new Set([MEMORY_REASON, USAGE_LIMIT_REASON])
const SOLO_SUFFIX = `${REASON_SEPARATOR}solo`
// A filing in this repository: one in another names its owner and repository before the `#`.
const THIS_REPOSITORY_REFERENCE = /^#(?<issue>\d+)$/u
const COLUMNS = [
	'dispatch wait',
	'dispatches',
	'median (min)',
	'max (min)',
	'longest',
	'over 1 min',
	NOT_MEASURED,
] as const
const ROW_LABEL = 'runnable → dispatch'

interface Span {
	from_ms: number
	to_ms: number
}

interface Stretch {
	from_ms: number
	after_ms: number
}

interface History {
	offers: ReadonlyArray<OfferEntry>
	since_ms: number
}

interface Wait {
	issue: number
	wait_ms: number
}

interface Records {
	entries: ReadonlyArray<LedgerEntry>
	seatless: ReadonlyArray<Span>
	filed: ReadonlyMap<number, number>
}

function ms_of(entry: { at: string }): number {
	return Date.parse(entry.at)
}

function is_offer(entry: LedgerEntry): entry is OfferEntry {
	return entry.kind === KIND.OFFER
}

function is_runnable(offer: OfferEntry, issue: number): boolean {
	return (
		offer.seen.includes(issue) && offer.excluded.every((exclusion) => exclusion.issue !== issue)
	)
}

function is_seat_end(entry: LedgerEntry): boolean {
	return entry.kind === KIND.HELD || entry.kind === KIND.RELEASED || is_dispatch(entry)
}

function is_seatless(entry: LedgerEntry): boolean {
	if (entry.kind === KIND.RELEASED) return true

	return (
		entry.kind === KIND.HELD &&
		(SEATLESS_REASONS.has(entry.reason) || entry.reason.endsWith(SOLO_SUFFIX))
	)
}

function seatless_spans(entries: ReadonlyArray<LedgerEntry>): Array<Span> {
	const marks = entries.filter((entry) => is_seat_end(entry))

	return marks.flatMap((mark, index) => {
		const next = marks[index + 1]

		return next !== undefined && is_seatless(mark)
			? { from_ms: ms_of(mark), to_ms: ms_of(next) }
			: []
	})
}

// Each issue of this repository a run filed, at its first filing.
function filed_reference(event: RunEvent): string {
	if (event.kind !== run_event_stream.EVENT_KIND.FILED) return ''

	return run_event_filed.parse(event.text)?.reference ?? ''
}

function filed_issue(event: RunEvent): number | undefined {
	const issue = THIS_REPOSITORY_REFERENCE.exec(filed_reference(event))?.groups?.['issue']

	return issue === undefined ? undefined : Number(issue)
}

// Each issue of this repository a run filed, at its first filing: the stream is oldest first, and a
// `Map` keeps the last of a repeated key, so the pairs go in newest first.
function filed_times(events: ReadonlyArray<RunEvent>): Map<number, number> {
	const pairs = events.flatMap((event): Array<[number, number]> => {
		const issue = filed_issue(event)

		return issue === undefined ? [] : [[issue, ms_of(event)]]
	})

	return new Map(pairs.toReversed())
}

// A `retry` offer excludes only the issues it was asked to, so it says nothing about the rest.
function is_decision(entry: LedgerEntry): entry is OfferEntry {
	return is_offer(entry) && entry.verdict !== RETRY_VERDICT
}

// The offers since the issue's previous dispatch that decided on it, and when that dispatch was.
function history_of(entries: ReadonlyArray<LedgerEntry>, index: number, issue: number): History {
	const before = entries.slice(0, index)
	const previous_index = before.findLastIndex(
		(entry) => is_dispatch(entry) && entry.issue === issue,
	)
	const previous = before[previous_index]
	const offers = before.slice(previous_index + 1).filter((entry) => is_decision(entry))

	return { offers, since_ms: previous === undefined ? -Infinity : ms_of(previous) }
}

// A stretch with no offer holding the issue back starts after its previous dispatch at the earliest.
function stretch_of(history: History, issue: number): Stretch | undefined {
	const { offers, since_ms } = history
	const blocked_index = offers.findLastIndex((offer) => !is_runnable(offer, issue))
	const first = offers[blocked_index + 1]

	if (first === undefined) return undefined

	const blocked = offers[blocked_index]

	return { from_ms: ms_of(first), after_ms: blocked === undefined ? since_ms : ms_of(blocked) }
}

// A filing between the last offer that could not start the issue and the stretch's first offer is when
// it became runnable; the next pass only read it.
function start_ms(stretch: Stretch, filed_ms: number | undefined): number {
	if (filed_ms === undefined) return stretch.from_ms

	return filed_ms > stretch.after_ms && filed_ms < stretch.from_ms ? filed_ms : stretch.from_ms
}

function overlap_ms(span: Span, from_ms: number, to_ms: number): number {
	return Math.max(0, Math.min(span.to_ms, to_ms) - Math.max(span.from_ms, from_ms))
}

function wait_of(records: Records, dispatch: DispatchEntry, index: number): Wait | undefined {
	const stretch = stretch_of(history_of(records.entries, index, dispatch.issue), dispatch.issue)

	if (stretch === undefined) return undefined

	const from_ms = start_ms(stretch, records.filed.get(dispatch.issue))
	const to_ms = ms_of(dispatch)
	const seatless = records.seatless
		.map((span) => overlap_ms(span, from_ms, to_ms))
		.reduce((sum, value) => sum + value, 0)

	return { issue: dispatch.issue, wait_ms: to_ms - from_ms - seatless }
}

function longest_of(waits: ReadonlyArray<Wait>): Wait | undefined {
	return waits.toSorted((left, right) => right.wait_ms - left.wait_ms)[0]
}

function row_of(waits: ReadonlyArray<Wait>, dispatches: number): string {
	const values = waits.map((wait) => wait.wait_ms)
	const longest = longest_of(waits)

	return lane_stats.to_row([
		ROW_LABEL,
		String(dispatches),
		lane_stage_stats.cell(lane_stats.median(values)),
		lane_stage_stats.cell(longest?.wait_ms),
		longest === undefined ? NOT_MEASURED : issue_cite.plain_for('terminal', longest.issue),
		String(values.filter((value) => value > LIMIT_MS).length),
		String(dispatches - waits.length),
	])
}

// The period's table: `entries` and `events` are the whole ledger and run-event stream, so a dispatch
// in the window finds the offers and the filing before it.
function table(
	entries: ReadonlyArray<LedgerEntry>,
	window: StatsWindow,
	events: ReadonlyArray<RunEvent> = [],
): string {
	const period = new Set(
		lane_stats.in_window(
			entries.filter((entry) => is_dispatch(entry)),
			window,
		),
	)
	const records = { entries, seatless: seatless_spans(entries), filed: filed_times(events) }
	const waits = entries.flatMap((entry, index) =>
		is_dispatch(entry) && period.has(entry) ? (wait_of(records, entry, index) ?? []) : [],
	)

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		row_of(waits, period.size),
	].join('\n')
}

const lane_dispatch_wait_stats = { table }

export { lane_dispatch_wait_stats }
