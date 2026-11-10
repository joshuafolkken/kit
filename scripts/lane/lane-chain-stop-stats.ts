import { lane_ledger, type LedgerEntry } from './lane-ledger'
import type { ChainEntry } from './lane-ledger-schema-ship'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'

// Why `josh run:chain` stopped and what each cause cost: the ledger's `chain` entries of one period
// reduced to one row per stage and reason, printed by `josh lane:stats` so the re-runs that dominate a
// lane's implement time are counted by cause (joshuafolkken/kit#7024).
//
// **A stop lasts until the next `run:chain` on its issue starts** — that run's end less its length. A
// stop no run followed is counted under `not re-run`, kept out of the minutes.

const COLUMNS = ['stopped at', 'stops', 'to re-run (min)', 'median (min)', 'not re-run'] as const
const JOIN_SUFFIX = ' --join'
const { NOT_MEASURED, is_number } = lane_stage_stats
// A period with no stop: the table still prints, so a reader sees zero stops rather than no table.
const NONE_ROW = ['none', '0', NOT_MEASURED, NOT_MEASURED, '0']

interface ChainStop {
	cause: string
	wait_ms: number | undefined
}

function is_chain(entry: LedgerEntry): entry is ChainEntry {
	return entry.kind === lane_ledger.KIND.CHAIN
}

function started_ms(chain: ChainEntry): number {
	return Date.parse(chain.at) - chain.elapsed_ms
}

function wait_ms(stop: ChainEntry, runs: ReadonlyArray<ChainEntry>): number | undefined {
	const stopped_ms = Date.parse(stop.at)
	const starts = runs
		.filter((run) => run.issue === stop.issue)
		.map((run) => started_ms(run))
		.filter((at) => at >= stopped_ms)

	return starts.length === 0 ? undefined : Math.min(...starts) - stopped_ms
}

// `check:related (exit)`, with `--join` on the half after the review, whose stage names repeat.
function cause_of(chain: ChainEntry): string | undefined {
	if (chain.stage === undefined || chain.reason === undefined) return undefined

	return `${chain.stage}${chain.join ? JOIN_SUFFIX : ''} (${chain.reason})`
}

function stops_of(
	period: ReadonlyArray<ChainEntry>,
	runs: ReadonlyArray<ChainEntry>,
): Array<ChainStop> {
	return period.flatMap((chain) => {
		const cause = cause_of(chain)

		return cause === undefined ? [] : { cause, wait_ms: wait_ms(chain, runs) }
	})
}

function total(values: ReadonlyArray<number>): number {
	return values.reduce((sum, value) => sum + value, 0)
}

function waits_of(stops: ReadonlyArray<ChainStop>, cause: string): Array<number> {
	return stops
		.filter((stop) => stop.cause === cause)
		.map((stop) => stop.wait_ms)
		.filter((value) => is_number(value))
}

function cause_row(cause: string, stops: ReadonlyArray<ChainStop>): string {
	const waits = waits_of(stops, cause)
	const count = stops.filter((stop) => stop.cause === cause).length

	return lane_stats.to_row([
		cause,
		String(count),
		lane_stage_stats.cell(waits.length === 0 ? undefined : total(waits)),
		lane_stage_stats.cell(lane_stats.median(waits)),
		String(count - waits.length),
	])
}

// The causes the period saw, the longest total first, so the cause worth removing next leads.
function causes_of(stops: ReadonlyArray<ChainStop>): Array<string> {
	const causes = [...new Set(stops.map((stop) => stop.cause))]

	return causes.toSorted(
		(left, right) => total(waits_of(stops, right)) - total(waits_of(stops, left)),
	)
}

// The period's table: `entries` is the whole ledger, so a run after the window ends a stop in it.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const stops = stops_of(
		lane_stats.in_window(entries, window).filter(is_chain),
		entries.filter(is_chain),
	)
	const rows = causes_of(stops).map((cause) => cause_row(cause, stops))

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...(rows.length === 0 ? [lane_stats.to_row(NONE_ROW)] : rows),
	].join('\n')
}

const lane_chain_stop_stats = { table }

export { lane_chain_stop_stats }
