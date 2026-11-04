import { run_ship_lap } from '#scripts/run/ship/run-ship-lap'
import {
	lane_ledger,
	type LedgerEntry,
	type ShipLapEntry,
	type TestRelatedEntry,
} from './lane-ledger'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'

// `josh lane:stats --pairs` (joshuafolkken/kit#6189): what the period's scoped pairs ran over, in one
// table — how many files each narrowed run named, why the import graph could not split a merge, and
// which hub put a `josh test:related` run past its reach cap — the tally a person grepped the ship logs
// for by hand. Each row counts its runs and sums their minutes.

const COLUMNS = ['group', 'row', 'runs', 'total min']
const NAMED_GROUP = 'named files'
const UNSPLIT_GROUP = 'unsplit'
const HUB_GROUP = 'over-cap hub'
// The named-file buckets the 2026-11-04 investigation counted by hand.
const FEW_FILES = 50
const MANY_FILES = 1000
// A failure's detail — the unresolved file, the thrown message — follows its fixed reason.
const DETAIL_LEAD = ': '

interface Tally {
	runs: number
	ms: number
}

type Tallies = Map<string, Tally>

interface Bucket {
	label: string
	holds: (named: number) => boolean
}

function is_few(named: number): boolean {
	return named < FEW_FILES
}

function is_many(named: number): boolean {
	return named > MANY_FILES
}

function is_between(named: number): boolean {
	return !is_few(named) && !is_many(named)
}

const BUCKETS: ReadonlyArray<Bucket> = [
	{ label: `<${String(FEW_FILES)}`, holds: is_few },
	{ label: `${String(FEW_FILES)}-${String(MANY_FILES)}`, holds: is_between },
	{ label: `>${String(MANY_FILES)}`, holds: is_many },
]

function is_pair_lap(entry: LedgerEntry): entry is ShipLapEntry {
	return entry.kind === lane_ledger.KIND.SHIP_LAP && entry.step === run_ship_lap.STEP.SCOPED_PAIR
}

function is_capped(entry: LedgerEntry): entry is TestRelatedEntry {
	return entry.kind === lane_ledger.KIND.TEST_RELATED && entry.over_cap_hub !== undefined
}

function bucket_of({ named }: ShipLapEntry): string | undefined {
	if (named === undefined) return undefined

	return BUCKETS.find((bucket) => bucket.holds(named))?.label
}

function reason_of({ unsplit }: ShipLapEntry): string | undefined {
	return unsplit?.split(DETAIL_LEAD)[0]
}

function hub_of({ over_cap_hub }: TestRelatedEntry): string | undefined {
	return over_cap_hub
}

function added(was: Tally | undefined, ms: number): Tally {
	return { runs: (was?.runs ?? 0) + 1, ms: (was?.ms ?? 0) + ms }
}

// Each row's runs and minutes under the name `key_of` gives it, the `seed` names first at zero.
function tally<T extends { elapsed_ms: number }>(
	rows: ReadonlyArray<T>,
	key_of: (row: T) => string | undefined,
	seed: ReadonlyArray<string> = [],
): Tallies {
	const tallies: Tallies = new Map(seed.map((name) => [name, { runs: 0, ms: 0 }]))

	for (const row of rows) {
		const key = key_of(row)

		if (key !== undefined) tallies.set(key, added(tallies.get(key), row.elapsed_ms))
	}

	return tallies
}

function ranked(tallies: Tallies): Tallies {
	return new Map([...tallies].toSorted((left, right) => right[1].ms - left[1].ms))
}

function group_rows(group: string, tallies: Tallies): Array<string> {
	return [...tallies].map(([name, { runs, ms }]) =>
		lane_stats.to_row([group, name, String(runs), lane_stage_stats.cell(ms)]),
	)
}

// The table of `window`'s scoped pair laps and capped `josh test:related` runs. The named-file buckets
// keep their size order and print at zero, so an empty bucket reads as measured.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const period = lane_stats.in_window(entries, window)
	const laps = period.filter((entry) => is_pair_lap(entry))
	const capped = period.filter((entry) => is_capped(entry))
	const labels = BUCKETS.map((bucket) => bucket.label)

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...group_rows(NAMED_GROUP, tally(laps, bucket_of, labels)),
		...group_rows(UNSPLIT_GROUP, ranked(tally(laps, reason_of))),
		...group_rows(HUB_GROUP, ranked(tally(capped, hub_of))),
	].join('\n')
}

const lane_pairs = { table }

export { lane_pairs }
