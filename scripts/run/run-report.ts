import { release_scope_cli, type Decision } from '#scripts/release/release-scope-cli'
import { run_event_scope, type EventScope } from './run-event-scope'
import { run_event_stream, type RunEvent } from './run-event-stream'

// The session-facing report generated *from* the run's event stream, rather than composed by hand each
// time (joshuafolkken/kit#2249). #2205 gave the run a typed, ordered stream of what happened — a plan, a
// launch, a merge, a park, a cut — and `format_event` already single-sources what one of those reads as.
// What was never single-sourced is the report a person receives: `backlogrun-progress.md` defined the
// epic completion summary in prose ("naming what was merged, what was parked and why, and what was
// filed"), so the AI reassembled the wording every run and two runs' summaries never lined up.
//
// **This is that generator, and it owns nothing `format_event` owns.** Each event line is `format_event`'s
// verbatim — the merges, the parks with their reason in the text, the cuts — so the enumeration is the
// stream rendered, not a second rendering of it. The only thing this adds is the release tail, which is
// not on the stream: whether a release is owed is `release:scope`'s answer, appended once at the end.
//
// **The Telegram body is this same string.** `run:report` prints it, and `josh notify --body-file` sends
// exactly what was printed, so the body a person reads off-screen and the summary a session shows are one
// text with one generator — the "no second format" the acceptance criteria pin.
//
// **And it covers one invocation, not the whole stream** (joshuafolkken/kit#2393, reported a second time
// after #2308 was closed with no fix behind it). The stream outlives an invocation by design — it is the
// repository's event log, not this run's — so a generator handed every event renders every run that ever
// appended one. Two days of merges arrived in one completion summary, and the Telegram body built from that
// output was rejected for length, which is the failure the generated report exists to prevent. The scope is
// therefore an **input**: the caller answers which invocation this is, from the run record that already
// holds the start time, and a scope nobody could determine prints a notice rather than everything. **The
// scoping itself is `run-event-scope.ts`'s** (joshuafolkken/kit#2395), shared with every other stream
// consumer rather than kept private here.

const LINE_SEPARATOR = '\n'

// What an undetermined scope prints in place of every event. It is a line rather than silence for the reason
// `release:scope` keeps `unknown` apart from `skip`: a reader given no line at all would read the empty
// report as an empty run, which is the rounding the criteria forbid.
const UNKNOWN_SCOPE_NOTICE =
	'Could not determine which invocation these events belong to, so none are shown rather than the whole stream. Begin a run record with `pnpm josh run:carry --begin` first.'

interface ReportInput {
	events: ReadonlyArray<RunEvent>
	release: Decision
	scope: EventScope
}

// The release verdict as the report's closing line, or nothing. `required` closes with the request and
// the exact command, and `unknown` says `unknown` — both carried verbatim in `release:scope`'s own reason,
// so the wording is that command's and not a second copy. **`skip` alone is silent**: appending a line for
// it is what would round `unknown` toward "nothing is owed", the mistake the criteria forbid, so the two
// stay distinguishable by the presence of the line itself.
function release_tail(release: Decision): string | undefined {
	if (release.scope === release_scope_cli.SKIPPED_SCOPE) return undefined

	return release.reason
}

// The report: this invocation's events as `format_event`'s lines, then the release tail when there is one.
// Handed the same events, scope and verdict it returns the same string, which is what the determinism test
// pins — nothing here reads a clock or the environment. The scoping is `run-event-scope.ts`'s, shared with
// every other stream consumer (joshuafolkken/kit#2395).
function build_report(input: ReportInput): string {
	const scoped = run_event_scope.scoped_events(input.events, input.scope)
	const lines =
		scoped === undefined
			? [UNKNOWN_SCOPE_NOTICE]
			: scoped.map((event) => run_event_stream.format_event(event))
	const tail = release_tail(input.release)

	return [...lines, ...(tail === undefined ? [] : [tail])].join(LINE_SEPARATOR)
}

const run_report = {
	UNKNOWN_SCOPE_NOTICE,
	build_report,
	release_tail,
}

export type { ReportInput }
export { run_report }
