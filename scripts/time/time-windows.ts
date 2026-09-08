import { time_format } from './time-format'
import { time_instant } from './time-instant'

// The three nested windows one run sits in (joshuafolkken/kit#1409).
//
// A run's report used to carry exactly one pair of stamps — `started_at` / `ended_at` — and a reader
// could not tell what the run itself controlled from what it merely waited inside. The hand
// measurement of run #1399 that filed this Issue read as three:
//
//   the run body                    06:52:19 → 07:12:17   20.0 min
//   the pull request, open→merged   07:03:10 → 07:11:23    8.2 min
//   the issue, opened→closed        06:46:50 → 07:11:24   24.6 min
//
// They nest in the sense that matters — the pull request lives inside the run, and the run lives
// inside the issue's life — so a proposal that shortens the run body is read against the 20 minutes
// and not against the 24.6, which is the distinction the single window could not make. **The nesting
// is not arithmetic containment**, and that same measurement shows why: the run went on to
// `josh ms` for 53 seconds after the merge closed the issue, so its end sits past the issue's. The
// order of the rows is the order of the questions, not a proof that each interval encloses the next.
//
// **These are not `pre-run` and `post-run`, and neither replaces the other.** Those two are *phases*
// — branch-attributed transcript spans that fall before `workflow_start_ms` or after the merge
// (`time-phases.ts` → `outside_phase`) — so they measure work this run did outside its own window and
// are deliberately never ranked (`.claude/skills/diag/SKILL.md` → "`pre-run`, `post-run` and
// `wait-outside` are not stages and are never ranked"). These three measure *wall windows* and cover
// no spans at all: nothing here is a share of `elapsed_ms`, and adding them to the phase table would
// double-count every minute in it. The phase rows say where the run's own time went; these say what
// each stretch of that time is answerable to.
//
// **Each window is read or not read, on its own.** A `--session` scope has neither a pull request nor
// an issue, an issue with no pull request has no middle window, and one still open has no third — and
// each of those is `not measured` rather than `0.0 min`, the distinction `time-format.ts` → `NOT_MEASURED`
// and `PhaseTotal.is_detected` already draw everywhere else in this report.
interface TimeWindow {
	started_at: string
	ended_at: string
	elapsed_ms: number
	// Whether both ends were read. A read window of zero length is a real measurement and prints
	// `0.0 min`; an unread one prints nothing in the duration column at all.
	is_read: boolean
}

// The two windows the transcript cannot answer: both come from GitHub, and both are absent for a
// scope that has no pull request or no issue. Handed to `time-report.ts` as one record rather than
// two fields, so a caller cannot supply one and forget the other.
interface OuterWindows {
	pull: TimeWindow
	issue: TimeWindow
}

interface RunWindows extends OuterWindows {
	run: TimeWindow
}

// Frozen because it is one object returned by reference from every unread answer — `build_window`,
// the issue read, and all three slots of `NO_WINDOWS`. A consumer that patched a window in place
// would otherwise rewrite every unread window in every report of a batch at once.
const UNREAD_WINDOW: TimeWindow = Object.freeze({
	started_at: '',
	ended_at: '',
	elapsed_ms: 0,
	is_read: false,
})

// What a scope with no GitHub half hands over — `josh time --session`, which has neither a pull
// request nor an issue to bound.
const NO_OUTER_WINDOWS: OuterWindows = { pull: UNREAD_WINDOW, issue: UNREAD_WINDOW }

// All three unread — what a report assembled without any window at all carries. It exists so a caller
// holding a whole `TimeReport` never spells the triple out itself: three `not measured` rows is the
// answer, and three literals is how one of them comes to say something else.
const NO_WINDOWS: RunWindows = { run: UNREAD_WINDOW, ...NO_OUTER_WINDOWS }

// **A missing end is `undefined`, never `0`.** An open pull request and an open issue both arrive
// that way, and `0` would read as "closed at the epoch" and produce a negative length — the same
// answer `PullSummary.merged_ms` already gives for exactly this reason.
function build_window(started_ms: number, ended_ms: number | undefined): TimeWindow {
	if (started_ms === 0 || ended_ms === undefined || ended_ms === 0) return UNREAD_WINDOW

	return {
		started_at: new Date(started_ms).toISOString(),
		ended_at: new Date(ended_ms).toISOString(),
		elapsed_ms: ended_ms - started_ms,
		is_read: true,
	}
}

// The run's own window is the pair the report already carried, so the innermost of the three is not
// measured a second time — it is the same wall window `window_of` builds, given a name.
function build_windows(started_ms: number, ended_ms: number, outer: OuterWindows): RunWindows {
	return { run: build_window(started_ms, ended_ms), pull: outer.pull, issue: outer.issue }
}

// **An unread instant is an empty string, not the epoch.** `new Date(0).toISOString()` is a real date
// nobody measured, and the report has printed `''` for a window it could not date since it had one.
function to_iso(timestamp_ms: number): string {
	return timestamp_ms === 0 ? '' : new Date(timestamp_ms).toISOString()
}

// Every window field a report carries, built together: the pair it has always had, and the three
// nested windows that pair is the innermost of. One call rather than three assignments a caller could
// let drift apart (joshuafolkken/kit#1409).
interface WindowFields {
	started_at: string
	ended_at: string
	windows: RunWindows
}

// **The windows are handed in rather than derived from the pair.** `started_at` / `ended_at` bound
// everything either source knows about, the pull request's own stamps included, so deriving the run
// body from them would print a run body identical to the pull request row whenever no transcript was
// found — a window nobody measured. Only the caller knows which spans are the run's.
function build_stamps(started_ms: number, ended_ms: number, windows: RunWindows): WindowFields {
	return { started_at: to_iso(started_ms), ended_at: to_iso(ended_ms), windows }
}

const HEADING = 'The three windows this run sits in:'
const RUN_LABEL = 'run body'
const PULL_LABEL = 'pull request open'
const ISSUE_LABEL = 'issue open'

// The clock pair is re-derived from the ISO strings rather than carried as a second pair of numbers:
// `--json` consumers read the stamps, the report reads the clock, and two representations of one
// instant are how the two come to disagree.
function clock_of(window: TimeWindow): string {
	const started_ms = time_instant.parse_instant(window.started_at) ?? 0
	const ended_ms = time_instant.parse_instant(window.ended_at) ?? 0

	return time_format.format_window(started_ms, ended_ms)
}

function window_row(label: string, window: TimeWindow): string {
	if (!window.is_read) return time_format.unmeasured_row(label)

	return time_format.format_row(label, window.elapsed_ms, clock_of(window))
}

// Printed under the heading rather than folded into the category table: these are windows, not
// shares, and a row of the table is a percentage of `elapsed_ms`.
function window_lines(windows: RunWindows): Array<string> {
	return [
		'',
		HEADING,
		window_row(RUN_LABEL, windows.run),
		window_row(PULL_LABEL, windows.pull),
		window_row(ISSUE_LABEL, windows.issue),
	]
}

const time_windows = {
	HEADING,
	RUN_LABEL,
	PULL_LABEL,
	ISSUE_LABEL,
	UNREAD_WINDOW,
	NO_OUTER_WINDOWS,
	NO_WINDOWS,
	build_window,
	build_windows,
	build_stamps,
	window_lines,
}

export type { OuterWindows, RunWindows, TimeWindow, WindowFields }
export { time_windows }
