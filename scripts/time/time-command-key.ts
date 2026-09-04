import { time_spans, type Span } from './time-spans'

// What counts as *the same command* across a run's spans (joshuafolkken/kit#1311).
//
// Two questions need it and used to answer it separately: the failure chain asks whether a call
// repeats one that just failed, and the per-invocation listing asks which calls belong on one row.
// Both mean the same thing by "the same command", so the rule sits here rather than in either of
// them — a second copy is the clone `CLAUDE.md` prohibits, in the one place a drift would make the
// rework figure and the per-invocation row disagree about which calls were the same command.
//
// **The josh subcommand wins where there is one.** `Bash: pnpm` alone would put `josh gate` and
// `josh lint` under one key, so the second would be read as a repeat of the first.
//
// **A call the transcript could not name has no key at all.** `time_spans` labels a result whose
// `tool_use` line was never written `unknown`, and every such call would otherwise share one key —
// so two unrelated tools would be chained together, and a per-invocation row would list durations
// belonging to different commands.
//
// **The label is as fine as a span can go.** `Read` and `Bash: git` are one key each, because a span
// keeps no input to narrow them by — the same granularity `by_tool` already reports at.

const UNNAMED_KEY = ''

function command_key(span: Span): string {
	if (span.label === time_spans.UNKNOWN_TOOL) return UNNAMED_KEY

	return span.josh_command === '' ? span.label : span.josh_command
}

const time_command_key = { UNNAMED_KEY, command_key }

export { time_command_key }
