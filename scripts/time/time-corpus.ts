import { cost_attribute } from '#scripts/cost/cost-attribute'
import { cost_transcript, type SessionFile } from '#scripts/cost/cost-transcript'
import { time_overlap } from './time-overlap'
import { time_spans, type Span } from './time-spans'

// The project's transcripts, read once and attributed to every issue asked about
// (joshuafolkken/kit#1284).
//
// **The walk used to be per issue, and `--epic` is per child.** `time-run.ts` collected one issue's
// spans by listing the transcript directory and reading every file in it, so an epic of eleven
// children read the same corpus eleven times — 669 files and 296 MB in this repository at the time
// this was written, and larger since joshuafolkken/kit#1285 taught the discovery to descend into
// each session's `subagents/`. Nothing about the second read could differ from the first: the files
// do not change while the command runs, and only the issue number the spans are filtered by does.
//
// **So the issue number moves inside the walk.** One pass over the directory reads each transcript
// once and hands its spans to every issue that transcript can contribute to. One issue asked about
// is the same walk with a list of one, which is why `--issue` reads exactly what it read before and
// there is no second collection path to disagree with this one.
//
// **The corpus is not held in memory, and that is deliberate.** Parsing every transcript up front
// and keeping the spans would make the per-issue lookup free, and it would also parse 296 MB of
// JSONL through zod to answer a question about eight branches. Each file is read, tested against the
// issue numbers, parsed only if one of them could match, and released — so what is held is one
// transcript at a time plus the spans actually attributed. **Those attributed spans are now N
// issues' worth rather than one's**, which is the batch's real cost and is bounded by what the batch
// was going to report anyway: eleven children of epic #1272 come to 2,691 spans.
//
// Attribution itself is untouched: `cost_attribute.records_for_issue` decides which spans belong to
// an issue here exactly as it does for `josh cost`, and is reused rather than restated.

const NO_ISSUES = 0
const NO_SESSIONS = 0

// A session that never wrote a line on the issue's branch can contribute nothing, because the
// fill-forward walk only ever carries a branch that session actually declared. So the test is exact
// rather than a heuristic, and it is a *superset* of the real match — a prose mention costs one
// parse and never a missed session, which is the direction a filter is allowed to be wrong in.
function may_mention_issue(text: string, issue_number: number): boolean {
	return text.includes(`"${String(issue_number)}-`)
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

// One issue's accumulation across the whole walk. Two structures, because the grouping and the
// counting ask different questions: the subtraction is per session, whether a transcript contributed
// anything is about the whole run, and a resumed transcript is a copy of an earlier one whichever
// session it sits under.
interface Collector {
	by_session: Map<string, Collected>
	counted: Map<string, Span>
	session_count: number
}

function new_collector(): Collector {
	return { by_session: new Map(), counted: new Map(), session_count: NO_SESSIONS }
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

// One transcript's contribution to one issue. Where a file's spans go is the only thing its origin
// decides.
function absorb_spans(collector: Collector, file: SessionFile, spans: ReadonlyArray<Span>): void {
	const group = group_for(collector.by_session, file)

	absorb(file.is_delegated ? group.delegated : group.own, spans)

	if (absorb(collector.counted, spans)) collector.session_count += 1
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

function to_issue_spans(collector: Collector): IssueSpans {
	return {
		spans: resolved_spans(collector.by_session),
		session_count: collector.session_count,
	}
}

// Built per call rather than shared, so no two callers hold the same `spans` array instance.
function empty_spans(): IssueSpans {
	return { spans: [], session_count: NO_SESSIONS }
}

// Which of the issues asked about this transcript can contribute to, paired with what accumulates
// them. Returning the collectors rather than the numbers is what keeps the loop below free of a
// lookup that could miss — every entry it walks came out of the map it would look in.
function mentioned_collectors(
	text: string,
	collectors: ReadonlyMap<number, Collector>,
): Array<[number, Collector]> {
	return [...collectors].filter(([issue_number]) => may_mention_issue(text, issue_number))
}

// One transcript, read once and parsed at most once however many issues it feeds. The parse is the
// expensive half — a zod pass per line — so it happens after the cheap text test has established
// that at least one issue could claim something, and its result is then filtered per issue.
function absorb_file(collectors: ReadonlyMap<number, Collector>, file: SessionFile): void {
	const text = cost_transcript.read_raw(file)
	const mentioned = mentioned_collectors(text, collectors)

	if (mentioned.length === NO_ISSUES) return

	const { spans } = time_spans.parse_timeline(text)

	for (const [issue_number, collector] of mentioned) {
		absorb_spans(collector, file, cost_attribute.records_for_issue(spans, issue_number))
	}
}

// Keyed by issue number, so a number repeated in an epic's task list is collected once rather than
// counted twice.
function collectors_for(issue_numbers: ReadonlyArray<number>): Map<number, Collector> {
	const collectors = new Map<number, Collector>()

	for (const issue_number of issue_numbers) collectors.set(issue_number, new_collector())

	return collectors
}

function to_results(collectors: ReadonlyMap<number, Collector>): Map<number, IssueSpans> {
	const found = new Map<number, IssueSpans>()

	for (const [issue_number, collector] of collectors) {
		found.set(issue_number, to_issue_spans(collector))
	}

	return found
}

// Every issue asked about, from one pass over the transcript directory. An issue with nothing
// attributed is present with an empty result rather than absent: "no transcript mentions it" is an
// answer, and a caller that had to tell it apart from "not asked for" would be re-deriving it.
//
// **Nothing asked means nothing read.** An epic whose task list names no issue in this repository —
// every child in another one, or an empty list — would otherwise read 296 MB to produce an empty
// map, which is worse than what this replaced: there the walk lived inside a per-child loop that
// never ran.
function collect_for_issues(
	cwd: string,
	issue_numbers: ReadonlyArray<number>,
): Map<number, IssueSpans> {
	const collectors = collectors_for(issue_numbers)

	if (collectors.size === NO_ISSUES) return to_results(collectors)

	const files = cost_transcript.list_sessions(cost_transcript.transcript_directory(cwd))

	for (const file of files) absorb_file(collectors, file)

	return to_results(collectors)
}

// One issue's spans — the same walk with a list of one, and never a second implementation of it.
function collect_issue_spans(cwd: string, issue_number: number): IssueSpans {
	return collect_for_issues(cwd, [issue_number]).get(issue_number) ?? empty_spans()
}

const time_corpus = {
	collect_for_issues,
	collect_issue_spans,
}

export type { IssueSpans }
export { time_corpus }
