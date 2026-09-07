// `josh run:progress` — the one line an unattended run prints when it has gone quiet, and the clock
// that decides when that is (joshuafolkken/kit#1520).
//
// **The trigger is silence, not a timer.** An `epicrun` reports when a child merges or is parked, and
// a child is 20–46 minutes of wall clock; between those two events it says nothing at all, so the
// person watching has to type "how is it going" to find out — the polling this command exists to
// remove. What it deliberately does **not** do is print on a fixed clock: the interval is measured
// from the last report of *any* kind, so a heartbeat never lands immediately behind a real one, where
// it would be noise rather than news. `--mark` is how the run tells this clock a real report happened.
//
// **A line that could say "still running" is a line not worth printing.** Five minutes was measured in
// live use on 2026-09-07 and 6 of 15 reports carried no changed number at all, which is the same
// information as silence. The default is therefore ten minutes, and every field below is re-read on
// each tick rather than remembered — a child's labels, whether a pull request exists yet, which lanes
// are open, the load average, and how long the whole set has been identical.
//
// **Nothing here reports a verification result.** No gate conclusion, no CI conclusion, no check
// rollup: this module reads none of them, and a result nobody read must never be printed as one. What
// it prints about a pull request is that one exists and what state GitHub calls it — which is a read
// it actually performs.

const DEFAULT_INTERVAL_MINUTES = 10
const MS_PER_MINUTE = 60_000
const MS_PER_SECOND = 1000
const DEFAULT_INTERVAL_MS = DEFAULT_INTERVAL_MINUTES * MS_PER_MINUTE

// What one child looked like on this tick. `pr_state` is `run_preflight`'s own vocabulary rather than
// a second spelling of it — `none` / `open` / `merged` / `closed`.
interface ChildObservation {
	issue: string
	labels: ReadonlyArray<string>
	pr_state: string
}

interface LaneObservation {
	issue: string
	state: string
}

interface Observations {
	children: ReadonlyArray<ChildObservation>
	lanes: ReadonlyArray<LaneObservation>
	load_average: number
	// Absent when no transcript path was given, and absent is printed as absent. Guessing an age for
	// a file nobody named would be exactly the unread result this command refuses to print.
	record_age_ms: number | undefined
}

// How long the *changing* part of the observation has been identical. Carried between ticks by the
// caller, because the loop is the only thing that lives across them.
interface ProgressState {
	key: string
	unchanged_since_ms: number
}

const NO_LANES = 'none'
const QUIET_MARKER = '⏳'

function to_minutes(elapsed_ms: number): number {
	return Math.floor(elapsed_ms / MS_PER_MINUTE)
}

function format_minutes(elapsed_ms: number): string {
	return `${String(to_minutes(elapsed_ms))}m`
}

/**
 * The part of an observation that is compared across ticks.
 *
 * **The load average and the record age are deliberately left out.** Both move on every tick by
 * construction, so including either would make "unchanged" impossible to reach and would throw away
 * the one field that says a run may be stuck. What is left is the set that only moves when the run
 * itself moves: which children are in flight, what they carry, and which lanes are open.
 */
function observation_key(observations: Observations): string {
	return JSON.stringify({ children: observations.children, lanes: observations.lanes })
}

/**
 * The unchanged-since clock, carried forward when the key matches and restarted when it does not.
 *
 * The first tick has no previous state and starts the clock at `now_ms`, which reads as `unchanged 0m`
 * — true, and honest about the fact that nothing has been compared yet.
 */
function next_state(
	previous: ProgressState | undefined,
	key: string,
	now_ms: number,
): ProgressState {
	if (previous?.key === key) return previous

	return { key, unchanged_since_ms: now_ms }
}

function format_child(child: ChildObservation): string {
	const labels = child.labels.length > 0 ? child.labels.join(',') : '(no labels)'

	return `#${child.issue} ${labels} PR:${child.pr_state}`
}

function format_lanes(lanes: ReadonlyArray<LaneObservation>): string {
	if (lanes.length === 0) return NO_LANES

	return lanes.map((lane) => `${lane.issue}:${lane.state}`).join(' ')
}

// Absent is said, never filled in. A run started without a transcript path prints `unread` here, which
// is what it is.
function format_record(record_age_ms: number | undefined): string {
	return record_age_ms === undefined ? 'unread' : `+${format_minutes(record_age_ms)}`
}

interface LineTiming {
	now_ms: number
	quiet_since_ms: number
	unchanged_since_ms: number
}

/**
 * One line, and it is one line on purpose: it is relayed into a session that is otherwise showing the
 * run's own output, and a block would compete with the thing the person is waiting to read.
 */
function format_line(observations: Observations, timing: LineTiming): string {
	const quiet = format_minutes(timing.now_ms - timing.quiet_since_ms)
	const unchanged = format_minutes(timing.now_ms - timing.unchanged_since_ms)
	const children = observations.children.map((child) => format_child(child)).join(' · ')
	const lanes = format_lanes(observations.lanes)
	const load = observations.load_average.toFixed(1)

	return `${QUIET_MARKER} quiet ${quiet} · ${children} · lanes ${lanes} · load ${load} · record ${format_record(observations.record_age_ms)} · unchanged ${unchanged}`
}

/**
 * Whether the silence has run long enough to be worth breaking.
 *
 * `>=` rather than `>`: the loop wakes on a timer that can land a millisecond early or late, and a
 * strict comparison there costs a whole extra sleep for no reason anyone could observe.
 */
function is_due(last_report_ms: number, now_ms: number, interval_ms: number): boolean {
	return now_ms - last_report_ms >= interval_ms
}

/**
 * The interval, from the environment, with the default for everything that is not a positive number.
 *
 * **Invalid falls back rather than throwing**, the reading `JOSH_CI_TIMEOUT_SECONDS` already uses: this
 * runs unattended in the background, and a run that dies on a typo in an optional setting has removed
 * the reporting the setting was there to tune.
 */
function interval_from(raw: string | undefined): number {
	const minutes = Number(raw)

	if (raw === undefined || raw.trim() === '' || !Number.isFinite(minutes) || minutes <= 0) {
		return DEFAULT_INTERVAL_MS
	}

	return minutes * MS_PER_MINUTE
}

const run_progress = {
	DEFAULT_INTERVAL_MINUTES,
	DEFAULT_INTERVAL_MS,
	MS_PER_MINUTE,
	MS_PER_SECOND,
	format_child,
	format_lanes,
	format_line,
	format_record,
	interval_from,
	is_due,
	next_state,
	observation_key,
}

export type { ChildObservation, LaneObservation, LineTiming, Observations, ProgressState }
export { run_progress }
