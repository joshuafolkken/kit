import { issue_cite, type IssueCiter } from '#scripts/issue/issue-cite'

// `josh run:progress` — the one line an unattended run prints when it has gone quiet, and the clock
// that decides when that is.
//
// **The trigger is silence, not a timer.** An `epicrun` reports when a child merges or is parked, and
// a child is 20–46 minutes of wall clock; between those two events it says nothing at all, so the
// person watching has to type "how is it going" to find out — the polling this command exists to
// remove. What it deliberately does **not** do is print on a fixed clock: the interval is measured
// from the last report of *any* kind, so a heartbeat never lands immediately behind a real one, where
// it would be noise rather than news. `--mark` is how the run tells this clock a real report happened.
//
// **A line that could say "still running" is a line not worth printing.** The default is twenty
// minutes: a child measures 20–46 minutes, and twenty gives one to two reports per child rather than a
// run of lines saying what the last one said. Every field below is
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
// **The line also says *when* it was observed, and not only how long the silence had run.** A
// relative figure means something only while the reports keep coming: a run suspended overnight would
// read its own `quiet 11m` as if no time had passed. Three decisions follow from that:
//
// - **The date is carried, not just the clock time.** A suspension can cross a day boundary, so an
//   `HH:MM` alone would leave the same hole open.
// - **The local clock leads, and UTC is printed beside it.** The local half is the one a person can
//   act on without converting anything. UTC is kept because the line is read from other machines and
//   from cloud sessions, where a timestamp rendered in the reader's zone makes one process look like a
//   stranger. The printed offset ties the two halves together, so a reader on a third machine can
//   place both.
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
// The switch that silences every progress report — the watcher's and `run:board --every`'s alike.
const DISABLED_KEY = 'JOSH_PROGRESS'
const DISABLED_VALUE = '0'

// What one child looked like on this tick. `pr_state` is `run_preflight`'s own vocabulary rather than
// a second spelling of it — `none` / `open` / `merged` / `closed`.
interface ChildObservation {
	issue: string
	// Kept from the `in-progress` listing the child was read from, so the line cites it in full
	// without a read per child.
	title: string
	labels: ReadonlyArray<string>
	pr_state: string
}

interface LaneObservation {
	issue: string
	state: string
}

interface Observations {
	// `owner/repo`, the repository the listing was read from — what every printed issue links into.
	repo: string
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
// The children slot when the run has started but no child carries `in-progress` yet. It is an
// observed fact — zero in-progress children — not a guess about
// what will appear: `read_observations` returns an observation at all only because a mechanical record
// (a lane, a hold, or a carried budget) says a run is underway, and the lanes field beside this one
// carries whatever evidence exists.
const NO_CHILD_YET = 'no in-progress child yet'
// The fifth line's value when there is no scheduled next report. The command always supplies one, but
// a line with no `next` field says the field was absent rather than inventing a time: `format_report`
// is a pure renderer, so its contract states the absence rather than assuming a stamp is always there.
const NO_NEXT = 'none'
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
 * **The local half leads because it is the half a person can act on.** UTC alone is a number the
 * reader has to convert before it means anything, and a stamp nobody can place is a stamp nobody reads.
 *
 * **UTC is kept beside it rather than replaced.** The line is relayed to other machines and read in
 * cloud sessions, where a timestamp rendered in the reader's zone makes one process look like a
 * stranger. Printing both costs twenty-five characters and leaves neither reader guessing — the
 * offset is what ties the two halves together, so a reader on a third machine can place the local
 * half as well.
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

// The issue leads as a citation rather than a bare `#N`: the parent relays these lines verbatim, and
// a bare number copied into a reply is what the Stop guard sends back.
function format_child(child: ChildObservation, cite: IssueCiter): string {
	const labels = child.labels.length > 0 ? child.labels.join(',') : '(no labels)'

	return `${cite(child.issue)} ${labels} PR:${child.pr_state}`
}

// An empty set is the pre-label stage, said as such rather than left as a blank slot between the
// separators. A `read_observations` result carries no children exactly when a run has started and
// none has reached `in-progress` yet, so this is the one place the two cases are told apart on the line.
function format_children(children: ReadonlyArray<ChildObservation>, repo: string): string {
	if (children.length === 0) return NO_CHILD_YET
	const cite = issue_cite.citer(repo, new Map(children.map((child) => [child.issue, child.title])))

	return children.map((child) => format_child(child, cite)).join(' · ')
}

// A lane is linked without its title: a lane in flight is a child the line above already cited in full,
// so repeating the title here would only lengthen the line.
function format_lanes(lanes: ReadonlyArray<LaneObservation>, repo: string): string {
	if (lanes.length === 0) return NO_LANES
	const cite = issue_cite.citer(repo, new Map())

	return lanes.map((lane) => `${cite(lane.issue)}:${lane.state}`).join(' ')
}

// Absent is said, never filled in. A run started without a transcript path prints `unread` here, which
// is what it is.
function format_record(record_age_ms: number | undefined): string {
	return record_age_ms === undefined ? 'unread' : `+${format_minutes(record_age_ms)}`
}

interface LineTiming {
	// The interval in force, already resolved by `run-progress-config.ts` → `resolve_interval_ms`. It
	// is passed in rather than read here so that the printed schedule and the clock `is_due` consults
	// can never be two different numbers.
	interval_ms: number
	now_ms: number
	quiet_since_ms: number
	unchanged_since_ms: number
}

/**
 * When the next line is due if the silence holds — printed, never left for a reader to work out.
 *
 * **The command holds both inputs, so it prints the result.** A run that derives a time by hand from
 * the `at` stamp plus the interval eventually derives it wrong; the judgement lives with the command
 * that already holds the inputs, as for `run:hold`, `delegate`, `review:level` and `latest:scope`.
 *
 * **It is a schedule rather than an observation, and the two conditions on it are said in prose**
 * (`docs/josh-commands-run.md` → `josh run:progress`): it holds only while the silence continues, and a
 * real report arriving first restarts the clock through `--mark` and supersedes it. The line printing
 * it is itself a report, so the clock starts at this observation.
 */
function format_next_report(now_ms: number, interval_ms: number): string {
	return format_observed_at(now_ms + interval_ms)
}

// The already-formatted field strings the five labelled lines are built from. They are kept as strings
// rather than the raw observation so that `format_report` stays a pure renderer the tests can drive with
// an absent `next`.
interface ReportFields {
	observed_at: string
	quiet: string
	unchanged: string
	children: string
	lanes: string
	load: string
	record: string
	next: string | undefined
}

// `next none` when there is no scheduled report, the stamp otherwise — the absence said the same way the
// other absent fields are (`record unread`, `lanes none`).
function format_next_line(next: string | undefined): string {
	return `next ${next ?? NO_NEXT}`
}

/**
 * The five labelled lines a quiet run prints — one field group per line, a label in front of every
 * field — so the parent relays the output verbatim and rounds, rephrases or re-labels nothing.
 *
 * The observation instant leads and the scheduled next closes it: the first field says whether
 * everything after it is still about now, and the last is the one field about a moment that has not
 * happened yet.
 */
function format_report(fields: ReportFields): string {
	return [
		`${QUIET_MARKER} at ${fields.observed_at}`,
		`quiet ${fields.quiet} · unchanged ${fields.unchanged}`,
		`children ${fields.children}`,
		`lanes ${fields.lanes} · load ${fields.load} · record ${fields.record}`,
		format_next_line(fields.next),
	].join('\n')
}

/**
 * The observations rendered into those five lines. It reads `now_ms` for both the observation stamp and
 * the scheduled next so the two can never disagree, and hands `format_report` already-formatted strings
 * so the rendering has one home.
 */
function format_line(observations: Observations, timing: LineTiming): string {
	return format_report({
		observed_at: format_observed_at(timing.now_ms),
		quiet: format_minutes(timing.now_ms - timing.quiet_since_ms),
		unchanged: format_minutes(timing.now_ms - timing.unchanged_since_ms),
		children: format_children(observations.children, observations.repo),
		lanes: format_lanes(observations.lanes, observations.repo),
		load: observations.load_average.toFixed(1),
		record: format_record(observations.record_age_ms),
		next: format_next_report(timing.now_ms, timing.interval_ms),
	})
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

function is_disabled(): boolean {
	return process.env[DISABLED_KEY] === DISABLED_VALUE
}

const run_progress = {
	DEFAULT_INTERVAL_MINUTES,
	DEFAULT_INTERVAL_MS,
	DISABLED_KEY,
	DISABLED_VALUE,
	INTERVAL_KEY,
	MS_PER_MINUTE,
	MS_PER_SECOND,
	NO_CHILD_YET,
	NO_NEXT,
	format_child,
	format_children,
	format_lanes,
	format_line,
	format_next_line,
	format_next_report,
	format_report,
	is_disabled,
	is_due,
	minutes_from,
	next_state,
	observation_key,
}

export type { ChildObservation, LaneObservation, Observations, ProgressState }
export { run_progress }
