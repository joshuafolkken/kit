import { time_checks, type CheckTotal } from './time-checks'
import { time_ci, type CiFacts } from './time-ci'
import { time_corpus, type IssueSpans } from './time-corpus'
import { time_github, type GhReader, type PullSearch, type PullSummary } from './time-github'
import { time_issue_window } from './time-issue-window'
import { time_last_select } from './time-last-select'
import type { Interval } from './time-overlap'
import { time_phase_costs, type PricedRequest } from './time-phase-costs'
import { time_phases } from './time-phases'
import { time_pull_files, type PullFileList } from './time-pull-files'
import { time_pull_index } from './time-pull-index'
import { time_report, type TimeReport } from './time-report'
import { time_request_costs, type PricedReader } from './time-request-costs'
import { time_rework, type DiffFacts, type DiffState } from './time-rework'
import { time_session_notes } from './time-session-notes'
import type { Span } from './time-spans'
import { time_windows, type RunWindows, type TimeWindow } from './time-windows'

// One `fullrun`, from the invocation to the merge (joshuafolkken/kit#1268).
//
// **Neither source can answer this alone**, and both halves were measured before the Issue was
// filed. The transcript stops at the last line anyone wrote, so PR #1263's `createdAt 08:57:20Z →
// mergedAt 09:00:32Z` — 3 minutes 12 seconds of CI wait and merge — appears in no session file.
// GitHub has no timestamp for the planning, implementation, gate and review that precede the pull
// request. And a run is not a session: a scan of the 25 most recent transcripts barely finds the
// branch for issue #1256, because that `fullrun` ran in a different one.
//
// So the two are joined on the issue number. The transcript side is attributed by branch through
// `cost_attribute`, unchanged and not copied; the GitHub side is `time-github.ts`'s.

const MS_PER_MINUTE = 60_000
const NO_SESSIONS = 0
// The no-argument default is the last run — `--last` narrowed to one (joshuafolkken/kit#1831). Going
// through the same selector is what gives the default `--last`'s rule for free: a merge whose head
// branch names no issue is not a run, so the newest such merge is skipped and the report says how
// many were.
const LATEST_RUN_COUNT = 1

// The subtraction both halves of this file need — the CI wait below and the delegated units above —
// is `time-overlap.ts`'s, so the same arithmetic answers both rather than being written twice.

// **The transcript side is read by `time-corpus.ts` and never here** (joshuafolkken/kit#1284). One
// issue's spans and a whole epic's come out of the same walk, so `--epic` reads the directory once
// for eleven children rather than eleven times — and there is no second collection path that could
// answer `--issue` differently from the batch it belongs to.

// **The per-check rows are `time-checks.ts`'s** (joshuafolkken/kit#1310). Each one needs the merge
// instant as well as its own stamps — a check that finished after the merge never held it up — and
// that instant is read here, so what this file does with the check list is hand both to one builder.

// The wall window the accounted time sits inside: the earliest thing either source knows about, and
// the latest. Printed so a reader can check the shares against something rather than trust them.
//
// **An issue with neither half known has no window at all**, and that case is real: a number that
// was never worked on here and never opened a pull request. `Math.min()` of nothing is `Infinity`,
// which `new Date(...).toISOString()` throws on — so the empty window is answered explicitly rather
// than computed, and the report prints no dates instead of failing.
function window_of(spans: ReadonlyArray<Span>, pull: PullSummary | undefined): Interval {
	const marks = [
		...spans.flatMap((span) => [span.ended_ms - span.duration_ms, span.ended_ms]),
		...(pull === undefined ? [] : [pull.created_ms, pull.merged_ms ?? pull.created_ms]),
	]

	if (marks.length === 0) return { started_ms: 0, ended_ms: 0 }

	return { started_ms: Math.min(...marks), ended_ms: Math.max(...marks) }
}

// Which of the three "no pull request" answers this was. **A failed read is not "there is none"**:
// an unauthenticated or rate-limited `gh` would otherwise be reported as a definitive absence, and
// reaching the page cap is not an answer either — "not found among the 500 most recently updated" is
// a different sentence from "there is none".
function absent_note(search: PullSearch, issue_number: number): string {
	const scope = `for issue #${String(issue_number)}`

	if (search.is_failed) return `the pull request listing could not be read ${scope}`
	if (search.is_exhausted) return `no pull request exists ${scope} — the CI wait is unknown`

	const budget = String(time_github.MAX_PAGES * time_github.PAGE_SIZE)

	return `no pull request found ${scope} among the ${budget} most recently updated — the CI wait is unknown`
}

function pull_note(search: PullSearch, issue_number: number): string {
	const { pull } = search

	if (pull === undefined) return absent_note(search, issue_number)

	if (pull.merged_ms === undefined) {
		return `PR #${String(pull.number)} is not merged — the run below stops at what is known`
	}

	return `PR #${String(pull.number)} merged`
}

// **`transcript(s)`, not `session(s)`** (joshuafolkken/kit#1285). The count is of transcripts that
// contributed, and a delegated unit is one of those while being part of a run rather than a run of
// its own — so an `epicrun` child would read `5 session(s)` for what everything else in this change
// calls one run. Counting only the sessions' own would be worse still: a child implemented entirely
// in a unit would then read `0`, and `span_note` would deny the transcript whose spans are printed
// beneath it.
function span_note(found: IssueSpans, issue_number: number): string {
	if (found.session_count === NO_SESSIONS) {
		return `no session transcript is attributed to issue #${String(issue_number)}`
	}

	return `${String(found.session_count)} transcript(s)`
}

// The phrase the unread note is recognized by, written once for the reason `OVERLAP_MARK` is: a run
// whose family lost a transcript still read its merge, so `--epic` would print a figure short by
// however long that transcript was with no sentence saying so.
// **The whole phrase, not the two words at the end of it.** `could not be measured` alone would also
// match a note written about something else, and a mark that matches a note it was not written for
// lets that note through a filter that was meant to hold it. It is kept clear of `2 transcript(s)`
// for the same reason from the other side: the span note above must not be swallowed by this one.
// **It says unmeasured rather than unread** (joshuafolkken/kit#1599). Two causes reach this sentence
// — a transcript that would not open, and one that opened onto no parseable span — and naming only
// the first would assert of the second that it could not be read, which is untrue of a file the run
// did read. What the reader needs is the consequence, and that is identical for both.
const UNREAD_MARK = 'transcript(s) of this run could not be measured'

function is_unread_note(note: string): boolean {
	return note.includes(UNREAD_MARK)
}

// **A transcript nobody could measure and one that cost nothing are different answers, and only one
// of them is a measurement** (joshuafolkken/kit#1439). `span_note` counts what contributed, so an
// unmeasured member of the run's own family is invisible there — the count stands above figures that
// are short by exactly what it held, and `2 transcript(s)` hides the third one's absence.
// **The sentence itself, taking a count rather than a scope.** The session scope reaches the same
// state — naming one unit reads the session that delegated it — and a second spelling of this note
// there would be free to disagree with this one about what the reader is being told.
function unread_lines(count: number): Array<string> {
	if (count === NO_SESSIONS) return []

	const held = 'so the figures below are missing their minutes rather than measuring them as zero'

	return [`${String(count)} ${UNREAD_MARK} — ${held}`]
}

function unread_note(found: IssueSpans): Array<string> {
	return unread_lines(found.unread_count)
}

// The phrase the overlap note is recognized by, written once so a renderer that has to let the note
// through matches this rather than a sentence it spells out for itself — the shape `time_row_cap`
// already uses for its truncation note.
const OVERLAP_MARK = 'wall clock concurrent sessions shared'

// **Whether a note is the overlap one.** `--epic` prints a child's notes only where the GitHub half
// is missing, which is never true of a completed child — so without a way to name this note it is
// invisible in exactly the scope whose child rows and batch total carry the inflated figure
// (joshuafolkken/kit#1330).
function is_overlap_note(note: string): boolean {
	return note.includes(OVERLAP_MARK)
}

// The phrase the refused-check note is recognized by, written once for the same reason `OVERLAP_MARK`
// is: `--epic` prints a child's notes only where the GitHub half is missing, and a child whose check
// read was refused *did* read its merge — so without a name for this note it is invisible in exactly
// the scope where the empty table has no other explanation (joshuafolkken/kit#1352).
const CHECK_READ_MARK = 'the CI check list could not be read'

function is_check_read_note(note: string): boolean {
	return note.includes(CHECK_READ_MARK)
}

// **An empty check table and a refused check read print identically, and only one of them is a
// measurement.** `ci_ms` comes from the pull request's own stamps, so the run stays measured and every
// figure stays right; what is missing is the per-check table alone, and saying nothing there reports a
// rate-limited `gh` as a run GitHub recorded no checks for.
function check_note(is_failed: boolean, issue_number: number): Array<string> {
	if (!is_failed) return []

	const scope = `for issue #${String(issue_number)}`

	return [
		`${CHECK_READ_MARK} ${scope} — the per-check table is empty for that reason, not because there were no checks`,
	]
}

// The phrase the refused-diff note is recognized by, written once for the reason `OVERLAP_MARK` is: a
// child whose diff read was refused *did* read its merge, so `--epic` and `--last` would print an
// unexplained `not measured` change size with no sentence saying why (joshuafolkken/kit#1387).
const DIFF_READ_MARK = 'the merged diff could not be read'

function is_diff_read_note(note: string): boolean {
	return note.includes(DIFF_READ_MARK)
}

// **An unread diff and a pull request that changed nothing print differently, and only one of them is a
// measurement.** Every other figure in the report stays right — the diff is read for the reconciliation
// alone — so without this the block reads as a run that changed no file and abandoned no edit, which is
// the one state a refused read cannot support. It is emitted only where a merged pull request was
// actually asked about: a run with no merge refused nothing, and `pull_note` already says so.
function diff_note(state: DiffState, issue_number: number): Array<string> {
	if (state !== time_rework.DIFF_REFUSED) return []

	const scope = `for issue #${String(issue_number)}`

	return [
		`${DIFF_READ_MARK} ${scope} — the change size and the landed/dropped column say \`not measured\` for that reason, not because nothing changed`,
	]
}

// The phrase the withheld-cycle note is recognized by, written once for the reason `OVERLAP_MARK` is.
const CYCLE_READ_MARK = 'the CI cycles could not be read'

// **A withheld `ci` row leaves the phase percentages short of the elapsed time, and this is what
// accounts for the difference** (joshuafolkken/kit#1384). The phase is withheld on the cycles alone,
// so a run whose commit listing or check-runs could not be read still has a measured `CI wait` share
// beside a phase table that says `not detected` — two rows a reader would otherwise take for a
// contradiction, in the one state where neither of them is wrong.
function cycle_note(ci: CiFacts, issue_number: number): Array<string> {
	if (!ci.has_ci_data || ci.has_windows) return []

	const scope = `for issue #${String(issue_number)}`

	return [
		`${CYCLE_READ_MARK} ${scope} — the \`ci\` phase says \`not detected\` for that reason, and the \`CI wait\` share beside it is still measured`,
	]
}

// Time inside the wall window that no span accounts for: two sessions with a gap between them.
function idle_note(gap_ms: number, span_ms: number): string {
	const gap = time_report.format_minutes(gap_ms)

	return `${gap} of the ${time_report.format_minutes(span_ms)} window is between sessions and belongs to nobody`
}

// The other direction, which used to be silent (joshuafolkken/kit#1330): the shares total *more* than
// the window they sit in, because two sessions attributed to one issue ran at the same wall clock.
//
// **It is reported rather than subtracted**, and that is not a smaller fix. Both sessions really did
// work in the minutes they shared, so there is no unit whose span could be trimmed the way a
// delegated one's is — which is why `time-corpus.ts` groups spans per session and refuses to pool
// their intervals: subtracting one session's from another's deletes real work with no note.
//
// **So the note names the denominator too.** Every category and phase percentage is taken against
// the accounted total, and once that total exceeds the window a reader who assumes the window is the
// denominator is ranking the phases against a number the report never used.
//
// **The sentence names no direction**, because the run scope prints it above the tables and `--epic`
// prints it indented under the child's row — "the shares below" would send an `--epic` reader looking
// beneath it for shares that sit on the line above.
//
// The excess is derived from the same two quantities the sentence prints rather than passed in, so
// it can never name some third figure. Each of the three is rounded to a tenth on its own, so the
// printed excess can sit a tenth off the difference of the printed pair — `--issue 1299` prints
// `77.6`, `49.9` and `27.6`. The arithmetic is exact and the display is not; subtracting the rounded
// pair instead would make the sentence self-consistent by printing an excess nobody measured.
function overlap_note(span_ms: number, elapsed_ms: number): string {
	const accounted = time_report.format_minutes(elapsed_ms)
	const shared = `${time_report.format_minutes(elapsed_ms - span_ms)} of it ${OVERLAP_MARK}`

	return `the shares total ${accounted} over a ${time_report.format_minutes(span_ms)} window — ${shared}, and every share and phase percentage is of the ${accounted}`
}

// **The two directions are one question asked with the sign kept.** Only the first was answered
// before, so a run whose sessions overlapped read exactly like one whose sessions did not.
function window_note(window: Interval, elapsed_ms: number): Array<string> {
	const span_ms = window.ended_ms - window.started_ms
	const idle_ms = span_ms - elapsed_ms

	if (idle_ms >= MS_PER_MINUTE) return [idle_note(idle_ms, span_ms)]
	if (elapsed_ms - span_ms >= MS_PER_MINUTE) return [overlap_note(span_ms, elapsed_ms)]

	return []
}

// Everything the two reads produced, before it becomes a report. Split out so `build_run_report`
// stays an assembly rather than a fetch plus an assembly.
interface RunFacts {
	issue_number: number
	found: IssueSpans
	search: PullSearch
	checks: Array<CheckTotal>
	// Whether the check-run read was refused rather than answered with nothing. Carried beside the
	// rows because an empty `checks` is both answers and only one of them is a measurement.
	is_check_read_failed: boolean
	ci: CiFacts
	// The merged diff, in the three states a read of it has (joshuafolkken/kit#1387). `refused` is what
	// the note below is written from; `absent` is an issue with no merged pull request, where nothing was
	// refused because nothing was asked.
	diff: DiffFacts
	// The outermost of the three windows — the issue's own opened→closed (joshuafolkken/kit#1409).
	// Neither the transcript nor the pull-request listing carries it, so it is its own read.
	issue_window: TimeWindow
	// This run's billed requests, priced and stamped, or `undefined` where the caller did not ask for
	// the cost corpus to be read (joshuafolkken/kit#1606).
	priced: ReadonlyArray<PricedRequest> | undefined
}

// Everything a merged pull request adds to the facts. Split out of `gather` so that function stays the
// two-branch answer it always was rather than growing a fetch inside one of them.
type MergedFacts = Omit<RunFacts, 'issue_number' | 'found' | 'search' | 'issue_window' | 'priced'>

// What an issue with no merged pull request has instead. Named rather than written inline, so the
// branch below stays one expression and `gather` keeps both reads in one `Promise.all`.
const NO_MERGED_FACTS: MergedFacts = {
	checks: [],
	is_check_read_failed: false,
	ci: time_ci.NO_CI,
	diff: time_rework.NO_DIFF,
}

// What one merged pull request is read with. A record rather than five positional parameters, which
// the four-parameter limit forbids anyway (joshuafolkken/kit#1387).
interface MergedInput {
	pull: PullSummary
	merged_ms: number
	found: IssueSpans
	read: GhReader
	// The work tree the transcript's absolute paths sit under, which is what makes them comparable with
	// the diff's repository-relative ones. It is the directory the transcripts were found by, so the two
	// halves of the reconciliation are keyed on one idea of "this project".
	cwd: string
}

function diff_facts(files: PullFileList, cwd: string): DiffFacts {
	const state = files.is_failed ? time_rework.DIFF_REFUSED : time_rework.DIFF_READ

	return { files: files.files, state, root: cwd }
}

// **The two reads are issued together rather than one after the other.** Neither needs the other's
// answer, and a batch scope pays this wait once per child (joshuafolkken/kit#1387). The CI facts do
// need the check list, so they follow it.
async function read_merged(input: MergedInput): Promise<MergedFacts> {
	const { pull, merged_ms, found, read } = input
	const [list, files] = await Promise.all([
		time_github.list_check_runs(pull.head_sha, read),
		time_pull_files.list_pull_files(pull.number, read),
	])
	const ci = await time_ci.build_facts({ pull, merged_ms, spans: found.spans, head: list, read })

	return {
		checks: time_checks.build_check_totals(list.runs, merged_ms),
		is_check_read_failed: list.is_failed,
		ci,
		diff: diff_facts(files, input.cwd),
	}
}

// What one run is measured from. A record rather than five positional parameters, which the
// four-parameter limit forbids anyway — `cwd` joined it when the diff reconciliation needed the work
// tree the transcript's absolute paths sit under (joshuafolkken/kit#1387).
interface RunInput {
	issue_number: number
	found: IssueSpans
	read: GhReader
	search: PullSearch
	cwd: string
	priced: ReadonlyArray<PricedRequest> | undefined
}

// The pull request is passed in rather than looked up here, because the no-argument path has already
// found it: resolving it and then searching for it again pages the same listing twice, spends up to
// ten requests where one would do, and lets the two reads disagree when a pull request merges
// between them.
//
// **The issue's own window is read beside the merged half rather than after it** (joshuafolkken/kit#1409).
// Neither needs the other's answer, and a batch scope would otherwise pay one more serial request per
// child — the same reason `read_merged` issues its own two together.
async function gather(input: RunInput): Promise<RunFacts> {
	const { issue_number, found, search, read, cwd } = input
	const { pull } = search
	const merged_ms = pull?.merged_ms
	const [issue_window, merged] = await Promise.all([
		time_issue_window.read_issue_window(issue_number, read),
		pull === undefined || merged_ms === undefined
			? Promise.resolve(NO_MERGED_FACTS)
			: read_merged({ pull, merged_ms, found, read, cwd }),
	])

	return { issue_number, found, search, issue_window, priced: input.priced, ...merged }
}

// **The two CI figures differ by exactly the cycles the merge command sat on, and the note is what
// says so** (joshuafolkken/kit#1384). The `CI wait` category is the part of the open→merge window no
// span covers, so a run that watched its own merge reads near zero there while the `ci` phase carries
// the real wait — two numbers a reader would otherwise take for a contradiction.
function serial_note(report: TimeReport): Array<string> {
	const phase = report.phases.find((total) => total.phase === time_phases.CI_PHASE)
	const serial_ms = (phase?.duration_ms ?? 0) - report.categories.ci_ms

	if (serial_ms <= 0) return []

	const spent = time_report.format_minutes(serial_ms)

	return [`${spent} of the merge command was waiting on CI — the phase table charges it to \`ci\``]
}

// **`has_ci_data` is whether a merge was actually read, not whether an issue scope was asked for.**
// Hardcoding it true printed `CI wait 0.0 min` directly beneath the note saying the CI wait is
// unknown — the measured zero standing in for an unknown that the flag exists to prevent.
// The middle of the three windows, from the pull request's own stamps (joshuafolkken/kit#1409). No
// pull request and one still open both answer unread — `build_window` takes the `undefined` end that
// `PullSummary.merged_ms` already carries for exactly that case.
function pull_window(pull: PullSummary | undefined): TimeWindow {
	return time_windows.build_window(pull?.created_ms ?? 0, pull?.merged_ms)
}

// **The innermost window is the transcript's alone** (joshuafolkken/kit#1409). `window_of` folds the
// pull request's stamps in so `started_at` / `ended_at` bound everything either source knows about;
// taking the run body from that pair printed a run nobody measured whenever the transcript was
// missing — `run body 8.2 min 07:03:10 → 07:11:23`, byte-identical to the pull request row beneath
// it — and an unmerged pull request with no spans made it a read, zero-length window, which is the
// measured zero standing in for an unknown that `is_read` exists to prevent.
function run_windows(facts: RunFacts): RunWindows {
	const spans = window_of(facts.found.spans, undefined)

	return {
		run: time_windows.build_window(spans.started_ms, spans.ended_ms),
		pull: pull_window(facts.search.pull),
		issue: facts.issue_window,
	}
}

// Everything the heading says about how the figures below it were read, in the order a reader meets
// them. Lifted out of `to_report` so that function stays an assembly rather than an assembly plus a
// list.
function run_notes(facts: RunFacts): Array<string> {
	const { found, search } = facts

	return [
		span_note(found, facts.issue_number),
		...time_session_notes.session_notes(found, facts.issue_number),
		...unread_note(found),
		pull_note(search, facts.issue_number),
		...check_note(facts.is_check_read_failed, facts.issue_number),
		...cycle_note(facts.ci, facts.issue_number),
		...diff_note(facts.diff.state, facts.issue_number),
	]
}

function to_report(facts: RunFacts): TimeReport {
	const { found, search } = facts
	const window = window_of(found.spans, search.pull)
	const notes = run_notes(facts)
	const report = time_report.build_from_spans({
		scope: `issue #${String(facts.issue_number)}`,
		spans: found.spans,
		started_ms: window.started_ms,
		ended_ms: window.ended_ms,
		ci: facts.ci,
		diff: facts.diff,
		windows: run_windows(facts),
		notes,
		by_check: facts.checks,
	})
	const found_notes = [...window_note(window, report.elapsed_ms), ...serial_note(report)]
	const phase_costs = time_phase_costs.build({
		spans: found.spans,
		requests: facts.priced,
		round_trip_count: report.round_trip_count,
	})

	return { ...report, notes: [...notes, ...found_notes], phase_costs }
}

// What a batch caller has already read for this child, so neither source is read once per child
// (joshuafolkken/kit#1284 for the transcripts, joshuafolkken/kit#1292 for the pull-request listing).
//
// **Both halves are present keys whose value may be `undefined`, rather than optional keys.** Under
// `exactOptionalPropertyTypes` an optional key rejects an explicit `undefined`, and a `Map#get` miss
// is exactly that — so the caller would need a shim per field to hand over what it collected.
interface RunSources {
	found: IssueSpans | undefined
	search: PullSearch | undefined
	// How to price this run's requests, or `undefined` to leave the phase costs unmeasured
	// (joshuafolkken/kit#1606). **A reader rather than the records themselves**, because the latest-run
	// path does not know which issue it is reporting on until it has resolved the merged pull request.
	//
	// **It is a third source rather than an unconditional read** for the reason the other two are
	// passed in: pricing walks the whole transcript directory, so a batch doing it per child pays that
	// walk once per child. `--issue` and the latest-run path opt in through `PRICED_SOURCES`; the
	// epic, last-N and history paths leave it unset and report the block as not measured. What the two
	// single-run paths pass is `time_request_costs.PRICED_SOURCES`, which lives beside the reader it
	// names rather than here, so nothing in this file has to import the corpus walk.
	priced_of: PricedReader | undefined
}

// What the batch paths pass: nothing was collected, and the cost corpus is not read.
const NO_SOURCES: RunSources = { found: undefined, search: undefined, priced_of: undefined }

// One issue's whole run. Never throws for a missing half: an issue with no pull request, an open
// one, a listing that could not be read, and a run with no transcript each report what is known and
// say what is not.
//
// **`sources` is the batch's way in, and its default is what `--issue` does.** A caller measuring
// several issues has already walked the transcript directory and paged the pull-request listing once
// for all of them, and passing those slices in is what stops both repeating per child; a caller
// measuring one passes nothing and both reads happen here, exactly as they always did.
async function build_run_report(
	issue_number: number,
	cwd: string,
	read: GhReader = time_github.read_gh,
	sources: RunSources = NO_SOURCES,
): Promise<TimeReport> {
	const search = sources.search ?? (await time_pull_index.pull_for_issue(issue_number, read))
	const found = sources.found ?? time_corpus.collect_issue_spans(cwd, issue_number)
	const priced = time_request_costs.priced_for(sources, cwd, issue_number)

	return to_report(await gather({ issue_number, found, read, search, cwd, priced }))
}

// What `pnpm josh time` with no argument reports on: the most recently merged pull request's issue,
// read from its head branch by the same rule the transcript side uses. `undefined` means no merged
// run could be resolved at all — reported in words by the caller, never as a zero.
//
// The listing is paged **once** and the pull request it found is handed straight to the report,
// which is why this is one function rather than a resolve followed by a lookup.
async function build_latest_run_report(
	cwd: string,
	read: GhReader = time_github.read_gh,
	sources: RunSources = NO_SOURCES,
): Promise<TimeReport | undefined> {
	const selection = await time_last_select.select_last_runs(LATEST_RUN_COUNT, read)
	const [run] = selection.runs

	if (run === undefined) return undefined

	const { issue_number } = run
	const found = time_corpus.collect_issue_spans(cwd, issue_number)
	const priced = time_request_costs.priced_for(sources, cwd, issue_number)
	const search = time_github.to_found(run.pull)
	const report = to_report(await gather({ issue_number, found, read, search, cwd, priced }))

	return {
		...report,
		notes: [...report.notes, ...time_last_select.skipped_note(selection.skipped_count)],
	}
}

const time_run = {
	is_overlap_note,
	is_check_read_note,
	is_diff_read_note,
	is_unread_note,
	unread_lines,
	build_run_report,
	build_latest_run_report,
}

export type { RunSources }
export { time_run }
