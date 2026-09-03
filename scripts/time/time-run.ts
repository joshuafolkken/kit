import { cost_attribute } from '#scripts/cost/cost-attribute'
import { cost_transcript, type SessionFile } from '#scripts/cost/cost-transcript'
import { time_github, type GhReader, type PullSearch, type PullSummary } from './time-github'
import { time_overlap, type Interval } from './time-overlap'
import { time_report, type LabelTotal, type TimeReport } from './time-report'
import { time_spans, type Span } from './time-spans'

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

// A session that never wrote a line on the issue's branch can contribute nothing, because the
// fill-forward walk only ever carries a branch that session actually declared. So the test is exact
// rather than a heuristic, and it is a *superset* of the real match — a prose mention costs one
// parse and never a missed session, which is the direction a filter is allowed to be wrong in.
function may_mention_issue(text: string, issue_number: number): boolean {
	return text.includes(`"${String(issue_number)}-`)
}

// Attribution is per session, exactly as on the cost side: the branch sequence a session walks is
// what carries the mapping, and concatenating sessions first would let one session's trailing branch
// claim the next session's opening spans.
function session_spans(text: string, issue_number: number): Array<Span> {
	if (!may_mention_issue(text, issue_number)) return []

	return cost_attribute.records_for_issue(time_spans.parse_timeline(text).spans, issue_number)
}

// Resuming or forking a session copies the earlier lines into a new transcript file, so one span can
// appear in several — `cost-cli.ts` measured 152 such duplicated requests in this repository's own
// transcripts. Per-session reading does not see them, and a run spanning sessions would count that
// time twice.
function span_key(span: Span): string {
	return [span.ended_ms, span.duration_ms, span.category, span.label].join('|')
}

// One session's spans folded in, answering whether it contributed anything the run had not already
// counted. **That answer is what `session_count` is, and it is not the number of files**: a resumed
// transcript is a copy of an earlier one, so counting files would print `2 transcript(s)` beside a
// span total that correctly counted those spans once — the note contradicting the arithmetic.
function absorb(seen: Map<string, Span>, spans: ReadonlyArray<Span>): boolean {
	const before = seen.size

	for (const span of spans) seen.set(span_key(span), span)

	return seen.size > before
}

interface IssueSpans {
	spans: Array<Span>
	session_count: number
}

// Drained with a loop rather than a spread of `Map#values()`: `Iterator#toArray` is not in this
// project's TS lib, and the spread form the linter would otherwise demand does not type-check — the
// same reason `time-report.ts` drains its totals map this way.
function values_of(seen: ReadonlyMap<string, Span>): Array<Span> {
	const unique: Array<Span> = []

	for (const [, span] of seen) unique.push(span)

	return unique
}

// One session's transcripts: its own, and the delegated units it ran (joshuafolkken/kit#1285).
//
// **The two are kept apart because they overlap.** A session that delegates holds one `Agent` tool
// span for the whole time the unit runs, and the unit's transcript records those same minutes as the
// work it did; folding them together counts that wall clock twice and leaves the four shares adding
// up to more than the run took.
interface Collected {
	own: Map<string, Span>
	delegated: Map<string, Span>
}

// Two structures, because the grouping and the counting ask different questions. The subtraction is
// per session; whether a transcript contributed anything is about the whole run, and a resumed
// transcript is a copy of an earlier one whichever session it sits under.
interface Collector {
	by_session: Map<string, Collected>
	counted: Map<string, Span>
}

// **Grouped by the session a transcript belongs with, not pooled.** A unit's work overlaps the wait
// of the session that delegated it and nothing else, so subtracting every unit's interval from every
// session's spans would delete real work: two sessions attributed to one issue can run at the same
// wall clock — a batch in the background while someone works interactively — and the interactive
// session's spans would fall inside a foreign unit's window and vanish with no note.
function group_for(by_session: Map<string, Collected>, file: SessionFile): Collected {
	const owner = cost_transcript.owning_session_id(file)
	const found = by_session.get(owner) ?? { own: new Map(), delegated: new Map() }

	by_session.set(owner, found)

	return found
}

// One transcript folded into the collection it belongs to, answering whether it contributed anything
// the run had not already counted. Where a file's spans go is the only thing its origin decides.
function absorb_file(collector: Collector, file: SessionFile, issue_number: number): boolean {
	const spans = session_spans(cost_transcript.read_raw(file), issue_number)
	const group = group_for(collector.by_session, file)

	absorb(file.is_delegated ? group.delegated : group.own, spans)

	return absorb(collector.counted, spans)
}

// Each session's spans resolved against its own units, then folded together under the same key — a
// resumed transcript is a copy, and a run spanning sessions must not count it twice.
//
// `resolve_delegated` is the identity for a session that delegated nothing, which is why a run that
// never delegated reports exactly as it did before.
function resolved_spans(by_session: ReadonlyMap<string, Collected>): Array<Span> {
	const seen = new Map<string, Span>()

	for (const [, collected] of by_session) {
		const resolved = time_overlap.resolve_delegated(
			values_of(collected.own),
			values_of(collected.delegated),
		)

		absorb(seen, resolved)
	}

	return values_of(seen)
}

function collect_issue_spans(cwd: string, issue_number: number): IssueSpans {
	const files = cost_transcript.list_sessions(cost_transcript.transcript_directory(cwd))
	const collector: Collector = { by_session: new Map(), counted: new Map() }
	let session_count = 0

	for (const file of files) {
		if (absorb_file(collector, file, issue_number)) session_count += 1
	}

	return { spans: resolved_spans(collector.by_session), session_count }
}

// Clamped at zero, because GitHub really does stamp a check as completed a fraction of a second
// before it started — measured on PR #1277, whose `Notify Auto Tag` printed as `-0.0 min`. A
// negative duration is a clock artefact, not a measurement, and it sorts to the bottom of a table
// where a reader reads it as a real figure.
function to_check_rows(
	runs: ReadonlyArray<{ name: string; started_ms: number; completed_ms: number }>,
): Array<LabelTotal> {
	return runs
		.map((run) => ({
			label: run.name,
			duration_ms: Math.max(0, run.completed_ms - run.started_ms),
			call_count: 1,
		}))
		.toSorted((left, right) => right.duration_ms - left.duration_ms)
}

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

function window_note(window: Interval, elapsed_ms: number): Array<string> {
	const span_ms = window.ended_ms - window.started_ms
	const gap_ms = span_ms - elapsed_ms

	if (gap_ms < MS_PER_MINUTE) return []

	return [
		`${time_report.format_minutes(gap_ms)} of the ${time_report.format_minutes(span_ms)} window is between sessions and belongs to nobody`,
	]
}

// Everything the two reads produced, before it becomes a report. Split out so `build_run_report`
// stays an assembly rather than a fetch plus an assembly.
interface RunFacts {
	issue_number: number
	found: IssueSpans
	search: PullSearch
	checks: Array<LabelTotal>
	ci_ms: number
}

// The pull request is passed in rather than looked up here, because the no-argument path has already
// found it: resolving it and then searching for it again pages the same listing twice, spends up to
// ten requests where one would do, and lets the two reads disagree when a pull request merges
// between them.
async function gather(
	issue_number: number,
	cwd: string,
	read: GhReader,
	search: PullSearch,
): Promise<RunFacts> {
	const found = collect_issue_spans(cwd, issue_number)
	const { pull } = search
	const merged_ms = pull?.merged_ms

	if (pull === undefined || merged_ms === undefined) {
		return { issue_number, found, search, checks: [], ci_ms: 0 }
	}

	const checks = to_check_rows(await time_github.list_check_runs(pull.head_sha, read))
	const ci_ms = time_overlap.uncovered_ms(
		{ started_ms: pull.created_ms, ended_ms: merged_ms },
		found.spans.map((span) => time_overlap.to_interval(span)),
	)

	return { issue_number, found, search, checks, ci_ms }
}

// **`has_ci_data` is whether a merge was actually read, not whether an issue scope was asked for.**
// Hardcoding it true printed `CI wait 0.0 min` directly beneath the note saying the CI wait is
// unknown — the measured zero standing in for an unknown that the flag exists to prevent.
function to_report(facts: RunFacts): TimeReport {
	const { found, search } = facts
	const window = window_of(found.spans, search.pull)
	const notes = [span_note(found, facts.issue_number), pull_note(search, facts.issue_number)]
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

// One issue's whole run. Never throws for a missing half: an issue with no pull request, an open
// one, a listing that could not be read, and a run with no transcript each report what is known and
// say what is not.
async function build_run_report(
	issue_number: number,
	cwd: string,
	read: GhReader = time_github.read_gh,
): Promise<TimeReport> {
	const search = await time_github.pull_for_branch_prefix(issue_number, read)

	return to_report(await gather(issue_number, cwd, read, search))
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

	return to_report(await gather(issue_number, cwd, read, search))
}

const time_run = {
	session_spans,
	collect_issue_spans,
	issue_of,
	build_run_report,
	build_latest_run_report,
}

export type { IssueSpans }
export { time_run }
