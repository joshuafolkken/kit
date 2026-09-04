import { cost_attribute } from '#scripts/cost/cost-attribute'
import { time_checks, type CheckTotal } from './time-checks'
import { time_corpus, type IssueSpans } from './time-corpus'
import { time_github, type GhReader, type PullSearch, type PullSummary } from './time-github'
import { time_overlap, type Interval } from './time-overlap'
import { time_pull_index } from './time-pull-index'
import { time_report, type TimeReport } from './time-report'
import type { Span } from './time-spans'

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
	ci_ms: number
}

// The pull request is passed in rather than looked up here, because the no-argument path has already
// found it: resolving it and then searching for it again pages the same listing twice, spends up to
// ten requests where one would do, and lets the two reads disagree when a pull request merges
// between them.
async function gather(
	issue_number: number,
	found: IssueSpans,
	read: GhReader,
	search: PullSearch,
): Promise<RunFacts> {
	const { pull } = search
	const merged_ms = pull?.merged_ms

	if (pull === undefined || merged_ms === undefined) {
		return { issue_number, found, search, checks: [], is_check_read_failed: false, ci_ms: 0 }
	}

	const list = await time_github.list_check_runs(pull.head_sha, read)
	const checks = time_checks.build_check_totals(list.runs, merged_ms)
	const ci_ms = time_overlap.uncovered_ms(
		{ started_ms: pull.created_ms, ended_ms: merged_ms },
		found.spans.map((span) => time_overlap.to_interval(span)),
	)

	return { issue_number, found, search, checks, is_check_read_failed: list.is_failed, ci_ms }
}

// **`has_ci_data` is whether a merge was actually read, not whether an issue scope was asked for.**
// Hardcoding it true printed `CI wait 0.0 min` directly beneath the note saying the CI wait is
// unknown — the measured zero standing in for an unknown that the flag exists to prevent.
function to_report(facts: RunFacts): TimeReport {
	const { found, search } = facts
	const window = window_of(found.spans, search.pull)
	const notes = [
		span_note(found, facts.issue_number),
		pull_note(search, facts.issue_number),
		...check_note(facts.is_check_read_failed, facts.issue_number),
	]
	const report = time_report.build_from_spans({
		scope: `issue #${String(facts.issue_number)}`,
		spans: found.spans,
		started_ms: window.started_ms,
		ended_ms: window.ended_ms,
		ci_ms: facts.ci_ms,
		has_ci_data: search.pull?.merged_ms !== undefined,
		notes,
		by_check: facts.checks,
	})

	return { ...report, notes: [...notes, ...window_note(window, report.elapsed_ms)] }
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
}

// What `--issue` passes: nothing was collected, so both halves are read here.
const NO_SOURCES: RunSources = { found: undefined, search: undefined }

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

	return to_report(await gather(issue_number, found, read, search))
}

function issue_of(pull: PullSummary | undefined): number | undefined {
	if (pull === undefined) return undefined

	const issue_number = cost_attribute.issue_from_branch(pull.branch)

	return issue_number === cost_attribute.UNATTRIBUTED_KEY ? undefined : issue_number
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
): Promise<TimeReport | undefined> {
	const search = await time_github.latest_merged_pull(read)
	const issue_number = issue_of(search.pull)

	if (issue_number === undefined) return undefined

	return to_report(
		await gather(issue_number, time_corpus.collect_issue_spans(cwd, issue_number), read, search),
	)
}

const time_run = {
	is_overlap_note,
	is_check_read_note,
	issue_of,
	build_run_report,
	build_latest_run_report,
}

export type { RunSources }
export { time_run }
