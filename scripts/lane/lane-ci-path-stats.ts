import { lane_check_stats } from './lane-check-stats'
import { lane_ledger, type LedgerEntry, type StageEntry } from './lane-ledger'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_stats, type StatsWindow } from './lane-stats'

// The followup's critical path (joshuafolkken/kit#5295): over the period's `ci-wait` rows, which check
// settled last — how often, and the median and maximum of when it settled into the wait — printed by
// `josh lane:stats`. A row from before the field, or a wait no check was seen to settle in, names none
// and is left out.

const COLUMNS = ['followup critical path', 'runs', 'median (s)', 'max (s)'] as const

interface LastCheck {
	name: string
	elapsed_ms: number
}

function settled({ last_check, check_ms }: StageEntry): LastCheck | undefined {
	if (last_check === undefined) return undefined

	const elapsed_ms = check_ms?.[last_check]

	return elapsed_ms === undefined ? undefined : { name: last_check, elapsed_ms }
}

function last_check_of(entry: LedgerEntry): LastCheck | undefined {
	if (entry.kind !== lane_ledger.KIND.STAGE || entry.stage !== lane_ledger_write.CI_WAIT_STAGE) {
		return undefined
	}

	return settled(entry)
}

function name_row(name: string, lasts: ReadonlyArray<LastCheck>): string {
	const elapsed = lasts.filter((last) => last.name === name).map((last) => last.elapsed_ms)

	return lane_stats.to_row([
		name,
		String(elapsed.length),
		lane_check_stats.cell(lane_stats.median(elapsed)),
		lane_check_stats.cell(lane_stats.peak(elapsed)),
	])
}

// The period's table: `entries` is the whole ledger, filtered here to `window`.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const lasts = lane_stats
		.in_window(entries, window)
		.map((entry) => last_check_of(entry))
		.filter((last) => last !== undefined)
	const names = [...new Set(lasts.map((last) => last.name))]

	return [...lane_check_stats.header(COLUMNS), ...names.map((name) => name_row(name, lasts))].join(
		'\n',
	)
}

// `issue`'s followup line detail for `lane:breakdown`: the last check its latest `ci-wait` row names,
// `''` where none does.
function last_check_text(entries: ReadonlyArray<LedgerEntry>, issue: number): string {
	const last = entries
		.filter((entry) => entry.kind === lane_ledger.KIND.STAGE && entry.issue === issue)
		.map((entry) => last_check_of(entry))
		.findLast((found) => found !== undefined)

	return last === undefined
		? ''
		: ` (last check: ${last.name} ${lane_check_stats.cell(last.elapsed_ms)}s)`
}

const lane_ci_path_stats = { last_check_text, table }

export { lane_ci_path_stats }
