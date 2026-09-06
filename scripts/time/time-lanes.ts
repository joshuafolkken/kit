import { time_overlap, type Interval } from './time-overlap'

// Lanes, read off the wall clock rather than off a field nothing writes (joshuafolkken/kit#1470).
//
// What wants shortening is the time until the backlog is empty, and that time is not readable from
// one run's internals: whether a lane sat idle, whether two runs serialized, and whether a wait was
// hidden behind other work are all questions about *several* runs at once.
//
// **There is no lane id to read, and inventing one would report a number nothing writes.** Parallel
// lanes are the subject of joshuafolkken/kit#1473 and do not exist yet, so a `lane` field on the run
// record would be written by nobody and reported as though it meant something. The lane a run sat in
// is therefore *derived*: runs are packed, in start order, into the lowest-numbered lane that was
// free when each one began — the standard interval-graph packing, whose lane count is exactly the
// peak number of runs in flight at once. **With nothing overlapping it yields one lane**, which is
// the honest answer for a backlog that has only ever been worked serially, rather than a table of
// empty lanes.
//
// **The interval arithmetic is `time-overlap.ts`'s**, not a second copy of it. That module exists so
// the same wall clock is never counted twice, and the exposed/hidden split below is exactly that
// subtraction asked at the scale of a run instead of a span.

const NONE = 0
const FIRST = 0
const SOLE = 1
const NOT_FOUND = -1
// Below two lanes nothing can be waiting on anything, so no stretch is a serialization: a single
// lane running one run after another is simply a backlog being worked, and naming that "serialized"
// would report the ordinary case as a finding.
const MIN_PARALLEL = 2

interface LaneRun extends Interval {
	issue: number
}

interface Lane {
	index: number
	runs: Array<LaneRun>
	busy_ms: number
}

// One stretch in which a single run held the only busy lane while the window had room for more —
// the shape "one lane waiting on another's completion" takes when read from wall clock alone. The
// issue is what the stretch is named by: it is the run everything else was behind.
interface SerialInterval {
	started_ms: number
	ended_ms: number
	issue: number
}

// A wait that had another run progressing beside it cost the backlog nothing; the same wait with
// nothing else in flight cost it the whole duration. The two are the same minutes told apart by
// what else was happening, which is why they are one record rather than two measurements.
interface Exposure {
	hidden_ms: number
	exposed_ms: number
}

// One slice of the window between two consecutive boundaries, with the runs that covered it. The
// boundaries are every start and end, so within one slice the set never changes.
interface Slice {
	started_ms: number
	ended_ms: number
	in_flight: Array<number>
}

function duration_of(run: Interval): number {
	return run.ended_ms - run.started_ms
}

function in_start_order(runs: ReadonlyArray<LaneRun>): Array<LaneRun> {
	return [...runs].toSorted((left, right) => left.started_ms - right.started_ms)
}

function lane_end(lane: Lane): number {
	return lane.runs.at(-1)?.ended_ms ?? NONE
}

function with_run(lane: Lane, run: LaneRun): Lane {
	return { index: lane.index, runs: [...lane.runs, run], busy_ms: lane.busy_ms + duration_of(run) }
}

// The lowest-numbered lane that was free when this run started, or a new one when every lane was
// still busy. **Lowest-numbered rather than most-recently-free**: the packing then leaves the extra
// lanes to the runs that genuinely needed them, so the lane count is the peak concurrency and not an
// artifact of the order lanes happened to be created in.
function place(lanes: ReadonlyArray<Lane>, run: LaneRun): Array<Lane> {
	const target = lanes.findIndex((lane) => lane_end(lane) <= run.started_ms)

	if (target === NOT_FOUND) {
		return [...lanes, with_run({ index: lanes.length, runs: [], busy_ms: NONE }, run)]
	}

	return lanes.map((lane, index) => (index === target ? with_run(lane, run) : lane))
}

function assign_lanes(runs: ReadonlyArray<LaneRun>): Array<Lane> {
	let lanes: Array<Lane> = []

	for (const run of in_start_order(runs)) lanes = place(lanes, run)

	return lanes
}

function boundaries(runs: ReadonlyArray<LaneRun>): Array<number> {
	const marks = new Set(runs.flatMap((run) => [run.started_ms, run.ended_ms]))

	return [...marks].toSorted((left, right) => left - right)
}

function covering(runs: ReadonlyArray<LaneRun>, slice: Interval): Array<number> {
	return runs
		.filter((run) => run.started_ms <= slice.started_ms && run.ended_ms >= slice.ended_ms)
		.map((run) => run.issue)
}

// The window cut at every start and every end, so concurrency is constant inside each piece and the
// pieces tile the window exactly once — the property that keeps a stretch from being counted under
// two different concurrency counts.
function slices_of(runs: ReadonlyArray<LaneRun>): Array<Slice> {
	const marks = boundaries(runs)

	return marks.slice(FIRST, -1).map((started_ms, index) => {
		const ended_ms = marks[index + 1] ?? started_ms

		return { started_ms, ended_ms, in_flight: covering(runs, { started_ms, ended_ms }) }
	})
}

function sole_issue(slice: Slice): number {
	return slice.in_flight[FIRST] ?? NONE
}

function continues(last: SerialInterval, slice: Slice): boolean {
	return last.issue === sole_issue(slice) && last.ended_ms === slice.started_ms
}

// Adjacent slices held by the same run are one stretch, not several: the cuts between them are other
// runs' boundaries, which say nothing about the run that was actually holding the lane.
function fold_serial(merged: ReadonlyArray<SerialInterval>, slice: Slice): Array<SerialInterval> {
	const last = merged.at(-1)

	if (last !== undefined && continues(last, slice)) {
		return [...merged.slice(FIRST, -1), { ...last, ended_ms: slice.ended_ms }]
	}

	return [
		...merged,
		{ started_ms: slice.started_ms, ended_ms: slice.ended_ms, issue: sole_issue(slice) },
	]
}

// The instants at which the window actually held more than one run. A stretch that touches one of
// them is a stretch the concurrency fell *from*; a stretch that touches none of them was never
// beside any other work at all.
function contended_edges(slices: ReadonlyArray<Slice>): Set<number> {
	const contended = slices.filter((slice) => slice.in_flight.length >= MIN_PARALLEL)
	const edges = new Set<number>()

	for (const slice of contended) edges.add(slice.started_ms).add(slice.ended_ms)

	return edges
}

function abuts(interval: SerialInterval, edges: ReadonlySet<number>): boolean {
	return edges.has(interval.started_ms) || edges.has(interval.ended_ms)
}

// **A slice with no run in flight is idle, never serialization.** Nothing is waiting on anything
// there; the backlog simply had no work running, which the lane table's idle column already says.
//
// **And a run that was alone in time is not serialization either, however many lanes the window
// opened somewhere else.** The peak concurrency is a property of the whole period: on a backlog with
// one overlapping pair on Monday and eight lone runs on Thursday, gating on it alone would report
// all eight as stretches "held while the others waited" and rank them as the waits to remove first —
// when nothing was waiting. So a stretch is kept only where it **abuts** a slice that really held
// two runs, which is the shape of a lane falling to one beside work that was still running.
function serial_intervals(runs: ReadonlyArray<LaneRun>, lane_count: number): Array<SerialInterval> {
	if (lane_count < MIN_PARALLEL) return []

	const slices = slices_of(runs)
	const edges = contended_edges(slices)
	const sole = slices.filter((slice) => slice.in_flight.length === SOLE)
	let merged: Array<SerialInterval> = []

	for (const slice of sole) merged = fold_serial(merged, slice)

	return merged.filter((interval) => abuts(interval, edges))
}

function others(runs: ReadonlyArray<LaneRun>, skip: number): Array<Interval> {
	return runs.filter((_, index) => index !== skip)
}

// How much of the runs' wall clock had something else running beside it, and how much did not. The
// exposed half is `uncovered_ms` asked once per run against every other run, which is the same walk
// the span arithmetic already uses — so the two halves add up to the busy total by construction
// rather than by agreement.
function exposure_of(runs: ReadonlyArray<LaneRun>): Exposure {
	const busy_ms = runs.reduce((sum, run) => sum + duration_of(run), NONE)
	const exposed_ms = runs.reduce(
		(sum, run, index) => sum + time_overlap.uncovered_ms(run, others(runs, index)),
		NONE,
	)

	return { hidden_ms: busy_ms - exposed_ms, exposed_ms }
}

// The wall clock the runs actually cover, first start to last end. **It is the denominator every
// share is taken against**, rather than the calendar period asked for: measuring idleness against
// seven days would price the nights nobody was working as lane idle time, which says nothing about
// how the lanes were used.
function span_of(runs: ReadonlyArray<LaneRun>): Interval | undefined {
	if (runs.length === NONE) return undefined

	return {
		started_ms: Math.min(...runs.map((run) => run.started_ms)),
		ended_ms: Math.max(...runs.map((run) => run.ended_ms)),
	}
}

const time_lanes = {
	duration_of,
	assign_lanes,
	serial_intervals,
	exposure_of,
	span_of,
}

export { time_lanes }
export type { Exposure, Lane, LaneRun, SerialInterval }
