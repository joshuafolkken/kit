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
// information as silence. Ten was measured next and was still short of a stage change, so the default
// is twenty minutes (joshuafolkken/kit#1570): a child measures 20–46 minutes, and twenty gives one to
// two reports per child rather than a run of lines saying what the last one said. Every field below is
// re-read on each tick rather than remembered — a child's labels, whether a pull request exists yet,
// which lanes are open, the load average, and how long the whole set has been identical.
//
// **The interval is kept here so one number answers for both halves of the mechanism.** The watcher
// asks `is_due` before it prints, and the trigger-delivered rule that refuses an early heartbeat
// (`scripts/rules/early-heartbeat.ts`) asks the same two functions rather than carrying a second copy
// of the clock — a guard that could disagree with the watcher it guards is worse than no guard.
//
// **Nothing here reports a verification result.** No gate conclusion, no CI conclusion, no check
// rollup: this module reads none of them, and a result nobody read must never be printed as one. What
// it prints about a pull request is that one exists and what state GitHub calls it — which is a read
// it actually performs.
//
// **The line also says *when* it was observed, and not only how long the silence had run**
// (joshuafolkken/kit#1560). A relative figure means something only while the reports keep coming: an
// `epicrun` suspended overnight resumed and read its own `quiet 11m` as if no time had passed, and
// concluded the machine's clock was broken when it matched GitHub's `Date` header to the second. Three
// decisions follow from that, and each is a decision rather than a default:
//
// - **The date is carried, not just the clock time.** The confusion above happened across a day
//   boundary, so an `HH:MM` alone would have left the same hole open.
// - **The local clock leads, and UTC is printed beside it.** The local half is the one a person can
//   act on without converting anything, which is what UTC alone denied a reader seven hours from it
//   (joshuafolkken/kit#1589). UTC is kept rather than replaced: the line is read from other machines
//   and from cloud sessions, and joshuafolkken/kit#1245 already paid for a timestamp rendered in the
//   reader's zone making one process look like a stranger. The printed offset ties the two halves
//   together, so a reader on a third machine can place both.
// - **It is added beside the elapsed figures, never in place of them.** How long it has been quiet and
//   when the observation was taken are two different facts, and neither can be reconstructed from the
//   other without knowing the answer already.

const DEFAULT_INTERVAL_MINUTES = 20
// The one name for the setting, so the watcher and the guard read the same variable rather than two
// spellings of it.
const INTERVAL_KEY = 'JOSH_PROGRESS_INTERVAL_MINUTES'
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
// `1970-01-01T00:00:00.000Z` cut after the minutes. Seconds are dropped because the interval this line
// breaks is measured in minutes, and a heartbeat that claims a precision nobody uses is noise.
const STAMP_END = 16
// Two digits for every calendar and clock field the local half prints, and for each half of the offset.
const PAD_WIDTH = 2
const MINUTES_PER_HOUR = 60

function to_minutes(elapsed_ms: number): number {
	return Math.floor(elapsed_ms / MS_PER_MINUTE)
}

function format_minutes(elapsed_ms: number): string {
	return `${String(to_minutes(elapsed_ms))}m`
}

function pad(value: number): string {
	return String(value).padStart(PAD_WIDTH, '0')
}

/**
 * The local clock's offset from UTC, in whole minutes, signed the way a reader expects to see it.
 *
 * `getTimezoneOffset` counts minutes the local zone is *behind* UTC, so the sign is inverted here — a
 * zone ahead of UTC answers a negative number there and has to read `+`.
 *
 * **It is rounded**, because a historic offset is not a whole number of minutes: `Asia/Kathmandu` was
 * `+05:41:16` until 1986, so a stamp taken at an instant in that era answers `-341.2666…` and the
 * minutes field would print `41.26666666666667` rather than `41`.
 */
function offset_minutes(date: Date): number {
	return Math.round(-date.getTimezoneOffset())
}

/** That offset written `+HH:MM` or `-HH:MM`, from the same rounded minute total the stamp is built on. */
function format_offset(total_minutes: number): string {
	const sign = total_minutes < 0 ? '-' : '+'
	const absolute = Math.abs(total_minutes)

	return `${sign}${pad(Math.floor(absolute / MINUTES_PER_HOUR))}:${pad(absolute % MINUTES_PER_HOUR)}`
}

/**
 * The instant this observation was taken, on the local clock and in UTC, with its date on both.
 *
 * **The local half leads because it is the half a person can act on.** The line used to carry UTC
 * alone, and on a machine seven hours ahead every stamp in the report was a number the reader had to
 * convert before it meant anything — which is the same failure joshuafolkken/kit#1560 filed, arriving
 * from the other side: a stamp nobody can place is a stamp nobody reads.
 *
 * **UTC is kept beside it rather than replaced.** The reason it was pinned is real and unchanged: the
 * line is relayed to other machines and read in cloud sessions, and joshuafolkken/kit#1245 already
 * paid for a timestamp rendered in the reader's zone making one process look like a stranger. Printing
 * both costs twenty-five characters and leaves neither reader guessing — the offset is what ties the
 * two halves together, so a reader on a third machine can place the local half as well.
 *
 * **The local half is read off the instant shifted by that same rounded offset, never off `getHours`
 * and `getMinutes`.** Those truncate the seconds of a sub-minute offset while the offset beside them
 * is rounded, so the two would disagree by a minute in a zone such as `Africa/Monrovia` (`-00:44:30`
 * in 1970) and the stamp would no longer parse back to the instant it was taken at. Shifting first and
 * reading UTC fields off the result makes the two halves consistent by construction.
 *
 * It reads the `now_ms` the line is already formatted against rather than calling a clock of its own,
 * so the stamp can never disagree with the elapsed figures printed beside it.
 */
function format_observed_at(now_ms: number): string {
	const minutes = offset_minutes(new Date(now_ms))
	const local = new Date(now_ms + minutes * MS_PER_MINUTE)
	const day = `${String(local.getUTCFullYear())}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
	const clock = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}${format_offset(minutes)}`

	return `${day} ${clock} / ${new Date(now_ms).toISOString().slice(0, STAMP_END)}Z`
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
 *
 * The observation time leads, because it is the field that says whether anything after it is still
 * about now — a stamp read after the elapsed figures is read too late to reframe them.
 */
function format_line(observations: Observations, timing: LineTiming): string {
	const observed_at = format_observed_at(timing.now_ms)
	const quiet = format_minutes(timing.now_ms - timing.quiet_since_ms)
	const unchanged = format_minutes(timing.now_ms - timing.unchanged_since_ms)
	const children = observations.children.map((child) => format_child(child)).join(' · ')
	const lanes = format_lanes(observations.lanes)
	const load = observations.load_average.toFixed(1)

	return `${QUIET_MARKER} at ${observed_at} · quiet ${quiet} · ${children} · lanes ${lanes} · load ${load} · record ${format_record(observations.record_age_ms)} · unchanged ${unchanged}`
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
 * One setting's minutes, or `undefined` for everything that is not a positive number.
 *
 * **Invalid answers `undefined` rather than throwing**, the reading `JOSH_CI_TIMEOUT_SECONDS` already
 * uses: this runs unattended in the background, and a run that dies on a typo in an optional setting
 * has removed the reporting the setting was there to tune. Which source is asked next, and in what
 * order, is `run-progress-config.ts` → `resolve_interval_ms`; this module answers about one value and
 * asks nothing else, which is what lets both the watcher and the guard read it the same way.
 */
function minutes_from(raw: string | undefined): number | undefined {
	const minutes = Number(raw)

	if (raw === undefined || raw.trim() === '' || !Number.isFinite(minutes) || minutes <= 0) {
		return undefined
	}

	return minutes
}

const run_progress = {
	DEFAULT_INTERVAL_MINUTES,
	DEFAULT_INTERVAL_MS,
	INTERVAL_KEY,
	MS_PER_MINUTE,
	MS_PER_SECOND,
	format_child,
	format_lanes,
	format_line,
	format_record,
	is_due,
	minutes_from,
	next_state,
	observation_key,
}

export type { ChildObservation, LaneObservation, LineTiming, Observations, ProgressState }
export { run_progress }
