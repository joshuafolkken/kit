import { lane_concurrency_stats } from './lane-concurrency-stats'
import { lane_ledger, type LedgerEntry, type LoadEntry } from './lane-ledger'
import { lane_limit_table } from './lane-limit-table'
import { lane_stats, type StatsWindow } from './lane-stats'

// The period split by how many lanes were active (joshuafolkken/kit#9171): a lane-limit comparison
// over the whole period mixes in the time the backlog left lanes empty, so a limit of 6 that ran 4
// lanes reads like a limit of 4. One row per active-lane count — a sample's `lanes` — and one row per
// limit over the filled time only, when at least the limit's lanes were active.
//
// A sample's time is the stretch to the next sample (`lane_stats.sampled_hours`); a merge counts
// under the latest load sample at or before it (`lane_concurrency_stats.lanes_at`, the concurrent-lanes
// table's rule) and the limit in force at it (`lane_limit_table.limit_at`).

const PERCENT = 100
const HOUR_DECIMALS = 2
const CELLS = [
	'hours',
	'merges',
	'merges / h',
	'load mean',
	'load peak',
	'load > cores %',
	'free GB mean',
	'free GB min',
]
const NOTE =
	'A merge counts under the active lanes of the latest load sample at or before it; one merge takes about 45 minutes, so a short row’s merges / h swings.'

// Where a sample or a merge falls: the lanes active and the limit in force.
interface Point {
	lanes: number
	limit: number | undefined
}

type Bucket = (point: Point) => boolean

interface Period {
	samples: ReadonlyArray<LoadEntry>
	merges: ReadonlyArray<Point>
	timeline: ReturnType<typeof lane_limit_table.timeline_of>
}

function is_load(entry: LedgerEntry): entry is LoadEntry {
	return entry.kind === lane_ledger.KIND.LOAD
}

function is_defined<T>(value: T | undefined): value is T {
	return value !== undefined
}

function merge_points(
	entries: ReadonlyArray<LedgerEntry>,
	window: StatsWindow,
	timeline: Period['timeline'],
): Array<Point> {
	const lane_samples = lane_concurrency_stats.samples_of(entries)

	return lane_stats
		.in_window(entries, window)
		.filter((entry) => entry.kind === lane_ledger.KIND.MERGE)
		.map((entry) => Date.parse(entry.at))
		.map((at_ms) => ({
			lanes: lane_concurrency_stats.lanes_at(lane_samples, at_ms) ?? 0,
			limit: lane_limit_table.limit_at(timeline, at_ms),
		}))
}

function period_of(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): Period {
	const timeline = lane_limit_table.timeline_of(entries)

	return {
		samples: lane_stats.in_window(entries, window).filter((entry) => is_load(entry)),
		merges: merge_points(entries, window, timeline),
		timeline,
	}
}

function point_of(period: Period, sample: LoadEntry): Point {
	return {
		lanes: sample.lanes ?? 0,
		limit: lane_limit_table.limit_at(period.timeline, Date.parse(sample.at)),
	}
}

function hours_cell(hours: number | undefined): string {
	return hours === undefined ? lane_stats.MISSING : hours.toFixed(HOUR_DECIMALS)
}

function rate_cell(merges: number, hours: number | undefined): string {
	return lane_stats.cell(hours === undefined ? undefined : merges / hours)
}

// The share of samples whose load average was over the machine's cores; rows without `cores` are
// left out.
function over_cores_cell(samples: ReadonlyArray<LoadEntry>): string {
	const rated = samples.filter((sample) => sample.cores !== undefined)
	const over = rated.filter((sample) => sample.load > (sample.cores ?? Infinity)).length

	return lane_stats.cell(rated.length === 0 ? undefined : (over / rated.length) * PERCENT)
}

function load_cells(samples: ReadonlyArray<LoadEntry>): Array<string> {
	const loads = samples.map((sample) => sample.load)
	const free = samples.map((sample) => sample.available_mb).filter(is_defined)

	return [
		lane_stats.cell(lane_stats.mean(loads)),
		lane_stats.cell(lane_stats.peak(loads)),
		over_cores_cell(samples),
		lane_stats.cell(lane_stats.gigabytes(lane_stats.mean(free))),
		lane_stats.cell(lane_stats.gigabytes(lane_stats.lowest(free))),
	]
}

function bucket_row(period: Period, label: string, is_in: Bucket): string {
	const counted = period.samples.filter((sample) => is_in(point_of(period, sample)))
	const counted_set = new Set(counted)
	const hours = lane_stats.sampled_hours(period.samples, (sample) => counted_set.has(sample))
	const merges = period.merges.filter((point) => is_in(point)).length

	return lane_stats.to_row([
		label,
		hours_cell(hours),
		String(merges),
		rate_cell(merges, hours),
		...load_cells(counted),
	])
}

function header_of(first: string): string {
	const columns = [first, ...CELLS]

	return [lane_stats.to_row(columns), lane_stats.to_row(columns.map(() => '---'))].join('\n')
}

function sorted_unique(values: ReadonlyArray<number>): Array<number> {
	return [...new Set(values)].toSorted((left, right) => left - right)
}

// One row per active-lane count the window's samples recorded, fewest first.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const period = period_of(entries, window)
	const counts = sorted_unique(period.samples.map((sample) => sample.lanes ?? 0)).filter(
		(lanes) => lanes > 0,
	)
	const rows = counts.map((lanes) =>
		bucket_row(period, String(lanes), (point) => point.lanes === lanes),
	)

	return ['By active lanes', header_of('active lanes'), ...rows, '', NOTE].join('\n')
}

// One row per limit the window's samples were written under, counting only the time at least the
// limit's lanes were active.
function filled_table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const period = period_of(entries, window)
	const limits = sorted_unique(
		period.samples.map((sample) => point_of(period, sample).limit).filter(is_defined),
	)
	const rows = limits.map((limit) =>
		bucket_row(period, String(limit), (point) => point.limit === limit && point.lanes >= limit),
	)

	return ['By lane limit, filled time only', header_of('filled limit'), ...rows].join('\n')
}

const lane_active_lanes_stats = { filled_table, table }

export { lane_active_lanes_stats }
