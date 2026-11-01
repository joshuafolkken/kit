import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { lane_breakdown, type Stage } from './lane-breakdown'
import { lane_breakdown_laps } from './lane-breakdown-laps'
import type { LedgerEntry } from './lane-ledger'
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

// One lane's stages and laps, one row per name. The laps read no transcript calls: a call names no
// lane, so another lane's Bash would fall into this one's time between ship stages.
function lane_parts(records: SinkRecords, issue: number): Array<Stage> {
	const breakdown = lane_breakdown.of(records.entries, records.events, issue)

	if (breakdown === undefined) return []

	const laps = lane_breakdown_laps.of(records.entries, issue, breakdown, [])
	const parts = [...breakdown.stages, ...[...laps.values()].flat()]

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

function sink_row(sink: Sink, issues: ReadonlyArray<OpenIssue> | undefined): string {
	return lane_stats.to_row([
		sink.name,
		lane_stage_stats.cell(total_ms(sink)),
		String(sink.per_lane_ms.length),
		lane_stage_stats.cell(lane_stats.median(sink.per_lane_ms)),
		lane_sinks_issues.cell(sink.name, issues),
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
	const sinks = sinks_of(records, over_issues(records, window, minutes))

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...sinks.map((sink) => sink_row(sink, issues)),
	].join('\n')
}

const lane_sinks = { DEFAULT_MINUTES, over_issues, sinks_of, table }

export { lane_sinks }
export type { Sink, SinkRecords }
