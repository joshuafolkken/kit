import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import type { LedgerEntry } from './lane-ledger-schema'
import { lane_size_stats } from './lane-size-stats'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'

// How long implementation takes per 100 actual non-test lines, over the period's merged lanes: the
// `implement` interval joined by issue to the size measured before the merge. The divisor is the
// actual count, not the declared one — a declaration's growth is `split_assess`'s own factor, never
// applied twice (joshuafolkken/kit#6021).
const COLUMNS = ['implement-rate lanes', 'implement min / 100 actual lines median']
const LINES_PER_RATE = 100
const DECIMALS = 1

interface ImplementRate {
	median: number
	lanes: number
}

function per_lines(ms: number | undefined, lines: number): number | undefined {
	return ms === undefined ? undefined : ((ms / MS_PER_MINUTE) * LINES_PER_RATE) / lines
}

// `entries` is the whole ledger: a lane merged in the window may have been dispatched before it.
function rates_of(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): Array<number> {
	const implement = lane_stage_stats.implement_by_issue(entries)

	return lane_size_stats
		.merged_sizes(entries, window)
		.filter((size) => size.actual.lines > 0)
		.map((size) => per_lines(implement.get(size.issue), size.actual.lines))
		.filter((value) => lane_stage_stats.is_number(value))
}

// The period's median and how many lanes it reads, none when no merged lane has both measurements.
function rate(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): ImplementRate | undefined {
	const rates = rates_of(entries, window)
	const median = lane_stats.median(rates)

	return median === undefined ? undefined : { median, lanes: rates.length }
}

function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const measured = rate(entries, window)

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		lane_stats.to_row([
			String(measured?.lanes ?? 0),
			measured?.median.toFixed(DECIMALS) ?? lane_stats.MISSING,
		]),
	].join('\n')
}

// The implement minutes `lines` take at the measured rate — the filing-time projection
// (joshuafolkken/kit#6025).
function minutes_for(lines: number, measured: ImplementRate): number {
	return (lines * measured.median) / LINES_PER_RATE
}

// Invert the same rate unit for a budget; missing or invalid rates cannot size a change.
function lines_for(minutes: number, measured: ImplementRate | undefined): number | undefined {
	if (measured === undefined || !Number.isFinite(measured.median) || measured.median <= 0) {
		return undefined
	}

	return (minutes * LINES_PER_RATE) / measured.median
}

const lane_implement_rate = { lines_for, minutes_for, rate, table }

export type { ImplementRate }
export { lane_implement_rate }
