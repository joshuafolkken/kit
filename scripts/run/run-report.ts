import { release_scope_cli, type Decision } from '#scripts/release/release-scope-cli'
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

const LINE_SEPARATOR = '\n'

interface ReportInput {
	events: ReadonlyArray<RunEvent>
	release: Decision
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

// The report: every event as `format_event`'s line, then the release tail when there is one. Handed the
// same events and the same verdict it returns the same string, which is what the determinism test pins —
// nothing here reads a clock or the environment.
function build_report(input: ReportInput): string {
	const lines = input.events.map((event) => run_event_stream.format_event(event))
	const tail = release_tail(input.release)

	return [...lines, ...(tail === undefined ? [] : [tail])].join(LINE_SEPARATOR)
}

const run_report = {
	build_report,
	release_tail,
}

export type { ReportInput }
export { run_report }
