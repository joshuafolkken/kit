import { backlog_drive_restore } from '#scripts/backlog/backlog-drive-restore'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import type { LedgerEntry } from './lane-ledger'
import { lane_net_time } from './lane-net-time'
import type { IssueAt, Span } from './lane-spans'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stop_stats } from './lane-stop-stats'
import { lane_yield } from './lane-yield'

// Where a `yield → redispatch` wait went (joshuafolkken/kit#5984), split at two instants:
//
// - `holder`: the yield note until the holder's lane ended — its `merge` line, or an event the driver
//   reads as a finished lane (`backlog-drive-restore.ts` → `DONE_KINDS`). A redispatch before any such
//   end closes it there: the holder ran through the whole wait.
// - `offer`: that end until the driver opened a lane for the yielded issue (`opening lane #N`), any
//   `offer:watch:*` hold between them included.
// - `launch`: the opening until the issue's `dispatch` line, the wait's own end.
//
// The holder is named only in the note's text (`lane-plan-check.ts` → `overlap_text`); a note naming
// none has no split, and its wait is counted whole. A part nothing ended stays not ended, and the part
// after it is absent.

const { EVENT_KIND } = run_event_stream

interface YieldParts {
	wait: Span
	holder?: Span
	offer?: Span
	launch?: Span
}

interface YieldPoints {
	ends: ReadonlyArray<IssueAt>
	openings: ReadonlyArray<IssueAt>
}

function points_of(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
): YieldPoints {
	const merges = entries
		.filter((entry) => lane_stage_stats.is_merge(entry))
		.map((entry) => ({ issue: entry.issue, at_ms: Date.parse(entry.at) }))
	const openings = events.filter((event) =>
		run_event_setup.is_stage(event, run_event_setup.LANE_STAGE.OPENING),
	)

	const done = events
		.filter((event) => backlog_drive_restore.DONE_KINDS.has(event.kind))
		.map((event) => ({ issue: lane_stop_stats.issue_of(event), at_ms: Date.parse(event.at) }))

	return {
		ends: [...merges, ...done],
		openings: lane_stop_stats.events_of(openings, EVENT_KIND.SETUP),
	}
}

// The earliest instant of `issue` in `points` from `from_ms` up to `until_ms`.
function first_at(
	points: ReadonlyArray<IssueAt>,
	issue: number,
	from_ms: number,
	until_ms: number,
): number | undefined {
	const inside = points.filter(
		(point) => point.issue === issue && point.at_ms >= from_ms && point.at_ms <= until_ms,
	)

	return inside.length === 0 ? undefined : Math.min(...inside.map((point) => point.at_ms))
}

// The offer and launch parts after the holder's end at `ended_ms`.
function after_holder(
	wait: Span,
	yielder: number,
	ended_ms: number,
	points: YieldPoints,
): YieldParts {
	const opened_ms = first_at(points.openings, yielder, ended_ms, wait.end_ms ?? Infinity)

	return {
		wait,
		holder: { from_ms: wait.from_ms, end_ms: ended_ms },
		offer: { from_ms: ended_ms, end_ms: opened_ms },
		...(opened_ms !== undefined && { launch: { from_ms: opened_ms, end_ms: wait.end_ms } }),
	}
}

function split_of(wait: Span, issues: [number, number], points: YieldPoints): YieldParts {
	const [yielder, holder] = issues
	const ended_ms = first_at(points.ends, holder, wait.from_ms, wait.end_ms ?? Infinity)

	return ended_ms === undefined
		? { wait, holder: { from_ms: wait.from_ms, end_ms: wait.end_ms } }
		: after_holder(wait, yielder, ended_ms, points)
}

function parts_of(note: RunEvent, wait: Span | undefined, points: YieldPoints): Array<YieldParts> {
	if (wait === undefined) return []

	const holder = lane_yield.holder_of(note)

	return holder === undefined
		? [{ wait }]
		: [split_of(wait, [lane_stop_stats.issue_of(note), holder], points)]
}

// Every yield note in the stream, beside its wait (`undefined` when `yield_spans` found none).
function notes_with_waits(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
): Array<{ note: RunEvent; wait: Span | undefined }> {
	const waits = lane_net_time.yield_spans(entries, events)

	return events
		.filter((event) => lane_yield.is_yield_note(event))
		.map((note, index) => ({ note, wait: waits[index] }))
}

// Every yield's wait with its parts. `yield_spans` keeps the notes' order, one wait per note.
function parts(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
): Array<YieldParts> {
	const points = points_of(entries, events)

	return notes_with_waits(entries, events).flatMap(({ note, wait }) => parts_of(note, wait, points))
}

// The holder's end until the redispatch — the offer and launch parts together, an opening the
// stream lacks included; `undefined` while the holder's lane or the redispatch has not happened.
function gap_ms({ wait, offer }: YieldParts): number | undefined {
	return offer === undefined || wait.end_ms === undefined ? undefined : wait.end_ms - offer.from_ms
}

// The yielder was dispatched again while its holder still ran, so no gap followed the holder's end.
function is_early({ wait, holder, offer }: YieldParts): boolean {
	return holder !== undefined && offer === undefined && wait.end_ms !== undefined
}

// One yield of `issue`: the holder it yielded to and the redispatch gap after the holder's end, or
// `is_early` when the redispatch came first.
interface IssueYield {
	holder: number | undefined
	gap_ms: number | undefined
	is_early: boolean
}

function issue_yield(note: RunEvent, split: YieldParts | undefined): IssueYield {
	return {
		holder: lane_yield.holder_of(note),
		gap_ms: split === undefined ? undefined : gap_ms(split),
		is_early: split !== undefined && is_early(split),
	}
}

// The yield notes `issue` took, beside their waits.
function notes_of(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	issue: number,
): Array<{ note: RunEvent; wait: Span | undefined }> {
	return notes_with_waits(entries, events).filter(
		({ note }) => lane_stop_stats.issue_of(note) === issue,
	)
}

// The yields `issue` took, in the notes' order (joshuafolkken/kit#5988).
function of_issue(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	issue: number,
): Array<IssueYield> {
	const points = points_of(entries, events)

	return notes_of(entries, events, issue).map(({ note, wait }) =>
		issue_yield(note, parts_of(note, wait, points).at(0)),
	)
}

// The parts of the yields `issue` took, in the notes' order (joshuafolkken/kit#6006).
function issue_parts(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	issue: number,
): Array<YieldParts> {
	const points = points_of(entries, events)

	return notes_of(entries, events, issue).flatMap(({ note, wait }) => parts_of(note, wait, points))
}

// The waits' holder parts and redispatch gaps together, and the ended waits of the notes naming no
// holder, which have no split; a part not ended counts none.
interface YieldShare {
	holder_ms: number
	gap_ms: number
	unsplit_ms: number
}

function part_ms(span: Span | undefined): number {
	return span?.end_ms === undefined ? 0 : span.end_ms - span.from_ms
}

function share_of(splits: ReadonlyArray<YieldParts>): YieldShare {
	return {
		holder_ms: splits.reduce((sum, split) => sum + part_ms(split.holder), 0),
		gap_ms: splits.reduce((sum, split) => sum + (gap_ms(split) ?? 0), 0),
		unsplit_ms: splits
			.filter((split) => split.holder === undefined)
			.reduce((sum, split) => sum + part_ms(split.wait), 0),
	}
}

const lane_yield_split = { issue_parts, of_issue, parts, share_of }

export { lane_yield_split }
export type { IssueYield, YieldParts, YieldShare }
