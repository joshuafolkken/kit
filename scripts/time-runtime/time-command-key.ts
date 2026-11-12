import { time_spans, type Span } from './time-spans'

// What counts as *the same command* across a run's spans.
//
// The failure chain and per-invocation listing need the same command identity so repeat detection
// and row grouping agree. Sharing that definition prevents their rework figures from drifting.
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

// **The parameter is the two fields it reads, not the whole `Span`.** A full span satisfies it, and so
// does a `ToolCall` the batching guard builds for a live call — the key has
// to mean the same thing whether it is read off a recorded span or the call about to repeat it.
function command_key(span: Pick<Span, 'label' | 'josh_command'>): string {
	if (span.label === time_spans.UNKNOWN_TOOL) return UNNAMED_KEY

	return span.josh_command === '' ? span.label : span.josh_command
}

const time_command_key = { UNNAMED_KEY, command_key }

export { time_command_key }
