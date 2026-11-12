import path from 'node:path'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_ship_lap } from '#scripts/run/ship/run-ship-lap'
import { lane_breakdown, type Stage } from './lane-breakdown'
import { lane_breakdown_laps } from './lane-breakdown-laps'
import { lane_ledger, type LedgerEntry, type TestRelatedEntry } from './lane-ledger'
import { lane_net_time } from './lane-net-time'
import { lane_sinks_issues, type OpenIssue } from './lane-sinks-issues'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'

// `josh lane:stats --sinks` (joshuafolkken/kit#5701): where the period's lanes over a threshold spent
// their time, summed over `lane:breakdown`'s own stages and laps — the triage a person did one
// `lane:breakdown` at a time. A lap overlaps the stage it ran in, so each row is its own sum, never a
// share of the lanes' total.

const DEFAULT_MINUTES = 30
// Where a lap's notes start — `scoped pair (run 2: …)`, `josh gate (reused ×2)` — dropped so every
// lane's run of a step sums into one row.
const NOTE_LEAD = ' ('
const COLUMNS = ['stage', 'total min', 'lanes', 'median min', 'open issues']
const { SCOPED_PAIR } = run_ship_lap.STEP

interface Sink {
	name: string
	per_lane_ms: ReadonlyArray<number>
}

interface SinkRecords {
	entries: ReadonlyArray<LedgerEntry>
	events: ReadonlyArray<RunEvent>
}

// Each issue merged inside `window` whose net lane time — what its breakdown adds up to — is over
// `minutes`, read unrounded so a fractional threshold keeps a lane just under it out.
function over_issues(records: SinkRecords, window: StatsWindow, minutes: number): Array<number> {
	const merged = lane_stats
		.in_window(records.entries, window)
		.filter((entry) => lane_stage_stats.is_merge(entry))
		.map((merge) => merge.issue)

	return [...new Set(merged)].filter(
		(issue) =>
			(lane_net_time.net_ms(records.entries, records.events, issue) ?? 0) > minutes * MS_PER_MINUTE,
	)
}

function base_name(name: string): string {
	const note_at = name.indexOf(NOTE_LEAD)

	return note_at === -1 ? name : name.slice(0, note_at)
}

// One lane's stages and their laps, one row per name — the driver's followup and its laps, outside
// the net time, left out (joshuafolkken/kit#6541). The laps read no transcript calls: a call names no
// lane, so another lane's calls would fall into this one's time between ship stages.
function lane_parts(records: SinkRecords, issue: number): Array<Stage> {
	const breakdown = lane_breakdown.of(records.entries, records.events, issue)

	if (breakdown === undefined) return []

	const laps = lane_breakdown_laps.of(records.entries, issue, breakdown, [])
	const parts = [
		...breakdown.stages,
		...breakdown.stages.flatMap((stage) => laps.get(stage.name) ?? []),
	]

	return lane_breakdown.ranked(parts.map((part) => ({ name: base_name(part.name), ms: part.ms })))
}

function total_ms(sink: Sink): number {
	return sink.per_lane_ms.reduce((sum, ms) => sum + ms, 0)
}

// Every stage the lanes spent time in, its time per lane, the longest total first.
function sinks_of(records: SinkRecords, issues: ReadonlyArray<number>): Array<Sink> {
	const sinks = new Map<string, Array<number>>()

	for (const issue of issues) {
		for (const { name, ms } of lane_parts(records, issue)) {
			sinks.set(name, [...(sinks.get(name) ?? []), ms])
		}
	}

	return [...sinks]
		.map(([name, per_lane_ms]) => ({ name, per_lane_ms }))
		.toSorted((left, right) => total_ms(right) - total_ms(left))
}

function is_test_related(entry: LedgerEntry): entry is TestRelatedEntry {
	return entry.kind === lane_ledger.KIND.TEST_RELATED
}

// Each distinct hub the `test:related` runs of `issues` named past the reach cap, the first named first.
function hubs_of(
	entries: ReadonlyArray<LedgerEntry>,
	issues: ReadonlyArray<number>,
): Array<string> {
	const named = entries
		.filter((entry) => is_test_related(entry))
		.filter((entry) => entry.issue !== undefined && issues.includes(entry.issue))
		.map((entry) => entry.over_cap_hub)
		.filter((hub) => hub !== undefined)

	return [...new Set(named)]
}

// The open Issues that name stage `name`. The scoped pair stage is also known by the files that put
// its `test:related` past the cap (joshuafolkken/kit#6198) — an Issue names a hub by its file name.
function issues_cell(
	name: string,
	issues: ReadonlyArray<OpenIssue> | undefined,
	hubs: ReadonlyArray<string>,
): string {
	const also = name === SCOPED_PAIR ? hubs.map((hub) => path.basename(hub)) : []

	return lane_sinks_issues.cell(name, issues, also)
}

function sink_row(
	sink: Sink,
	issues: ReadonlyArray<OpenIssue> | undefined,
	hubs: ReadonlyArray<string>,
): string {
	return lane_stats.to_row([
		sink.name,
		lane_stage_stats.cell(total_ms(sink)),
		String(sink.per_lane_ms.length),
		lane_stage_stats.cell(lane_stats.median(sink.per_lane_ms)),
		issues_cell(sink.name, issues, hubs),
	])
}

// The table of the stages the lanes of `window` over `minutes` spent their time in, each beside the
// open Issues that name it (`undefined` when the listing was unreadable).
function table(
	records: SinkRecords,
	window: StatsWindow,
	minutes: number,
	issues: ReadonlyArray<OpenIssue> | undefined,
): string {
	const lanes = over_issues(records, window, minutes)
	const hubs = hubs_of(records.entries, lanes)

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...sinks_of(records, lanes).map((sink) => sink_row(sink, issues, hubs)),
	].join('\n')
}

const lane_sinks = {
	DEFAULT_MINUTES,
	base_name,
	hubs_of,
	issues_cell,
	over_issues,
	sinks_of,
	table,
	total_ms,
}

export { lane_sinks }
export type { Sink, SinkRecords }
