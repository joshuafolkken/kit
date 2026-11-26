import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { lane_breakdown, type Stage } from './lane-breakdown'
import { lane_implement_split } from './lane-implement-split'
import type { LedgerEntry } from './lane-ledger'
import { lane_phases } from './lane-phases'
import { lane_stats } from './lane-stats'

// `josh lane:breakdown --period <days>` (joshuafolkken/kit#8998): each implement-split segment's
// median over the lanes merged in the last `days` days, read off the ledger alone — a lane the
// ledger holds no dispatch or no split rows of is left out of the sample, never estimated.

type Split = ReadonlyArray<Stage>

function split_of(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	issue: number,
): Split | undefined {
	if (!lane_implement_split.has_rows(issue, entries)) return undefined
	// The ledger and events alone: reading each lane's transcripts for its first edit
	// (`lane_breakdown_implement.breakdown_of`) takes minutes over a period's lanes.
	const breakdown = lane_breakdown.of(entries, events, issue)
	if (breakdown === undefined) return undefined

	return lane_implement_split.of(issue, breakdown, entries)
}

function segment_ms(splits: ReadonlyArray<Split>, name: string): Array<number> {
	return splits
		.map((split) => split.find((stage) => stage.name === name)?.ms ?? 0)
		.filter((ms) => ms > 0)
}

function segment_line(splits: ReadonlyArray<Split>, name: string): string {
	const values = segment_ms(splits, name)
	const median = lane_stats.median(values)
	const median_text = median === undefined ? 'none' : lane_breakdown.minutes_text(median)

	return `- ${name}: median ${median_text}, in ${String(values.length)} of ${String(splits.length)} runs`
}

// The report: a head line naming the sample, then a line per segment; the median is over the runs
// that spent time on the segment, the count says how many did.
function text(splits: ReadonlyArray<Split>, days: number, merged: number): string {
	const head = `Implement split, lanes merged in the last ${String(days)} days: ${String(splits.length)} of ${String(merged)} split (the rest have no dispatch or split rows in the ledger)`
	if (splits.length === 0) return head

	return [head, ...lane_implement_split.PRINTED.map((name) => segment_line(splits, name))].join(
		'\n',
	)
}

function report(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	days: number,
	now_ms: number,
): string {
	const { since_ms, until_ms } = lane_stats.window_of(days, now_ms)
	const merged = lane_phases.merged_in(entries, { from_ms: since_ms, to_ms: until_ms })
	const splits = merged
		.map((issue) => split_of(entries, events, issue))
		.filter((split) => split !== undefined)

	return text(splits, days, merged.length)
}

const lane_implement_split_stats = { report, text }

export { lane_implement_split_stats }
