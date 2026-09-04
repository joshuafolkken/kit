import { time_command_key } from './time-command-key'
import { time_format } from './time-format'
import { time_round_trips } from './time-round-trips'
import { time_spans, type Span, type SpanOutcome } from './time-spans'

// How much of a run's clock went on doing something a second time because it failed the first
// (joshuafolkken/kit#1309).
//
// The other `time-*` modules answer *where* the wall clock went: which command, which phase, how
// many round trips. None of them could say whether a command's time was work or rework. On the run
// this was filed from, three of five verification-gate runs were failures — one spell-check test
// half a second over its timeout, one resident-document size violation whose own test ran in five
// milliseconds — and the report printed `josh gate 4 calls, 133 s` with nothing to distinguish the
// one run that was needed from the three that were not. "Fail less" never reached the list of
// candidates, because no figure showed it was available.
//
// **A re-run is the next call of the same command after one that failed** — not every repeat. A
// command run twice by design (the gate runs once beside the review and again over the bumped tree)
// is not rework, and counting repeats alone would charge that to failure. The identity a repeat is
// judged on is the josh subcommand where there is one and the tool label otherwise, which is the
// same key the report's two tables are already built on: a run's `josh gate` calls sit in one row
// there and in one chain here.
//
// **What this cannot see, stated plainly.** The outcome is the harness's `is_error`, which reports
// the *tool call*, not the command inside it. `pnpm josh gate 2>&1 | tail -40` exits with `tail`'s
// status, so a red gate read through a pipe comes back `ok` and its re-run is invisible here. That
// is a property of how the call was written rather than of this measurement, and the figures below
// are therefore a floor on the rework a run did, never a ceiling.

// A call whose result carried no outcome at all — a file read, an answered question — and the
// running totals it contributes to nothing but this count.
interface FailureTotals {
	failed_call_count: number
	unknown_call_count: number
	// The time spent on calls that repeated a command whose previous attempt failed.
	rerun_ms: number
	// Whether any outcome was readable at all. `false` withholds the figures rather than printing
	// them as zero, on the same criterion the three category shares are withheld on: a run nobody
	// could read the outcomes of failed nothing *that was seen*, which is not the same as failing
	// nothing.
	is_measured: boolean
}

const NO_FAILURES: FailureTotals = {
	failed_call_count: 0,
	unknown_call_count: 0,
	rerun_ms: 0,
	is_measured: false,
}

const HEADING = 'Failure re-runs:'
const FAILED_LABEL = 'failed calls'
const RERUN_LABEL = 're-run after failure'
const UNREADABLE_SUFFIX = 'outcome unreadable'
const NONE = 0

// What a repeat is judged the same as — `time-command-key.ts`'s rule, shared with the per-invocation
// listing since joshuafolkken/kit#1311 rather than restated here. An unnamed call is in no chain at
// all: it is still *counted*, because it failed and the count is about the run rather than about any
// one command, but `did_command_fail` reads the empty key and leaves it out of the chain.
function key_of(span: Span): string {
	return time_command_key.command_key(span)
}

function is_tool(span: Span): boolean {
	return span.category === time_spans.TOOL_CATEGORY
}

// **A continuation contributes its time but neither a count nor a decision** (joshuafolkken/kit#1304
// for the split, joshuafolkken/kit#1309 for what it means here). One call bracketing a delegated unit
// comes back from `time_overlap.trim` as a head and a tail; counting the tail as a call would report
// a re-run the run never made, and *dropping* it would charge the re-run only its head — seconds —
// while the minutes it really took stay in the `tool execution` the share is quoted against.
function counted(span: Span, wanted: SpanOutcome): number {
	if (span.is_continuation) return 0

	return span.outcome === wanted ? 1 : 0
}

// An outcome the transcript actually carried. A continuation repeats its head's, so reading it again
// would say nothing the head did not already say.
function is_readable(span: Span): boolean {
	return !span.is_continuation && span.outcome !== time_spans.UNKNOWN_OUTCOME
}

function accumulate(totals: FailureTotals, span: Span, is_rerun: boolean): FailureTotals {
	return {
		failed_call_count: totals.failed_call_count + counted(span, time_spans.FAILED_OUTCOME),
		unknown_call_count: totals.unknown_call_count + counted(span, time_spans.UNKNOWN_OUTCOME),
		rerun_ms: totals.rerun_ms + (is_rerun ? span.duration_ms : 0),
		is_measured: totals.is_measured || is_readable(span),
	}
}

// **The chain is two records, kept apart because they are keyed differently.** `failed_commands`
// remembers, per command, whether its last call failed — which is what makes the next call a re-run.
// `rerun_calls` remembers which *calls* were re-runs, keyed by the call id a continuation shares with
// its head, so a tail is charged the way its own head was.
//
// **Keying the second one by command would be wrong, and quietly.** Two `Task` calls issued in one
// turn — which the turn-batching rule actively encourages — are both split by `time_overlap.trim`, so
// the walk is `A head, B head, …, A tail, B tail` with one label between them. A per-command slot is
// overwritten by `B head` before `A tail` reads it, and the tail — the fragment that carries the
// minutes — is then billed by B's decision instead of its own.
interface Chain {
	failed_commands: Map<string, boolean>
	rerun_calls: Set<string>
}

// A call nothing could name is in no command chain: a failure of one is never answered by the next.
// Asked here rather than in the loop, so the unnamed call stays inside the counts and outside the
// chain — the pair of answers it needs.
function did_command_fail(chain: Chain, key: string): boolean {
	if (key === time_command_key.UNNAMED_KEY) return false

	return chain.failed_commands.get(key) === true
}

// A failure arms its command and the next call of that command answers it, whatever that call's own
// outcome was. So a command that failed twice before passing contributes two re-runs — the second
// attempt and the third — rather than one, which is what the wasted time actually was.
function is_rerun_span(chain: Chain, span: Span): boolean {
	if (span.is_continuation) return chain.rerun_calls.has(span.call_id)

	return did_command_fail(chain, key_of(span))
}

// Only a head writes: a continuation is the same call, and re-recording it would answer its own
// command's next call with the outcome that call already answered.
function record(chain: Chain, span: Span, is_rerun: boolean): void {
	if (span.is_continuation) return

	chain.failed_commands.set(key_of(span), span.outcome === time_spans.FAILED_OUTCOME)
	if (is_rerun) chain.rerun_calls.add(span.call_id)
}

// **Ordered before it is walked, not assumed ordered.** One session's spans arrive in time order; a
// run's do not — a delegated unit's are appended after the parent's, and `time_corpus` concatenates
// one session after another. Walked in array order, a failure in one session would arm a command that
// the next session's first call then answers as a re-run.
function build_failures(spans: ReadonlyArray<Span>): FailureTotals {
	const chain: Chain = {
		failed_commands: new Map<string, boolean>(),
		rerun_calls: new Set<string>(),
	}
	let totals = { ...NO_FAILURES }

	// A loop rather than `reduce`, which this project's lint config forbids.
	for (const span of time_round_trips.in_time_order(spans)) {
		if (!is_tool(span)) continue

		const is_rerun = is_rerun_span(chain, span)

		record(chain, span, is_rerun)
		totals = accumulate(totals, span, is_rerun)
	}

	return totals
}

// How many of the run's calls came back with nothing to read, said beside the failure count rather
// than folded into it. Silent, where every outcome was readable — a line that appears every time is
// one nobody reads. **It has no counterpart on the withheld rows**, where the count would be the call
// count the round-trip block already prints: there, "nothing was readable" is the whole answer.
function unreadable_note(unknown_call_count: number): string {
	if (unknown_call_count === NONE) return ''

	return `, ${String(unknown_call_count)} ${UNREADABLE_SUFFIX}`
}

// The re-run time is quoted against tool execution rather than against the elapsed time, because that
// is the share it was taken out of: a second `josh gate` lengthens the run by exactly what the tool
// spent, and a percentage of a window that also holds model wait and CI reads smaller than the thing
// it describes.
function measured_lines(totals: FailureTotals, call_count: number, tool_ms: number): Array<string> {
	const of_calls = `of ${String(call_count)} call(s)${unreadable_note(totals.unknown_call_count)}`
	const share = `${time_format.format_share(totals.rerun_ms, tool_ms)} of tool execution`

	return [
		time_format.format_columns(FAILED_LABEL, String(totals.failed_call_count), of_calls),
		time_format.format_row(RERUN_LABEL, totals.rerun_ms, share),
	]
}

// **A run whose outcomes were never readable says so rather than reporting no failures.** Zero here
// would read as a run that got everything right first time, which is the one answer the transcript
// cannot support — the same shape, and the same word, the three category shares already use.
function failure_lines(totals: FailureTotals, call_count: number, tool_ms: number): Array<string> {
	const heading = ['', HEADING]

	if (!totals.is_measured) {
		return [
			...heading,
			time_format.unmeasured_row(FAILED_LABEL),
			time_format.unmeasured_row(RERUN_LABEL),
		]
	}

	return [...heading, ...measured_lines(totals, call_count, tool_ms)]
}

const time_failures = {
	HEADING,
	FAILED_LABEL,
	RERUN_LABEL,
	UNREADABLE_SUFFIX,
	NO_FAILURES,
	build_failures,
	failure_lines,
}

export type { FailureTotals }
export { time_failures }
