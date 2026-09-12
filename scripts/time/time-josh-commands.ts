import type { Span } from './time-spans'

// Expanding a chained call so every josh command it ran is counted (joshuafolkken/kit#1883).
//
// A Bash call that runs `pnpm josh lint:related && pnpm josh test:related` is one span carrying one
// `josh_command` — the first — so `by_josh_command` and `by_invocation`, both keyed on that field,
// never counted `test:related`. run #1864 showed the symptom: `josh lint:related 4 call(s)` and no
// `josh test:related` row, though the same four chained calls ran both.
//
// **The count is branched from the duration, which is why this expands rather than re-reads the field.**
// One Bash span is an indivisible duration (the shell measured the whole chain at once), so the measured
// time stays attributed to the chain's first josh command and each later one is counted with none. A
// virtual span per dropped command lets the existing totals keep their single key and single duration
// untouched — the first span prices the chain, and the virtual ones add only their call. `by_invocation`
// already notes its durations do not reconcile to wall clock, so a later command's `0.0s` there is of a
// piece with that table, not a new exception.

const NO_DURATION = 0

// The josh commands this span's `josh_command` does not already stand for. When `josh_command` is the
// first segment's (the common case) that is everything after it; when the first command is not josh
// — `git foo && pnpm josh test` — the span stands for none, so all of them were being dropped.
function uncounted_commands(span: Span): ReadonlyArray<string> {
	return span.josh_command === '' ? span.josh_commands : span.josh_commands.slice(1)
}

// A counted call for a josh command the first span did not cover: the span with its key swapped and its
// duration zeroed, so it adds one call and no time. `is_continuation` is forced false because this is a
// fresh counted call, never a trimmed tail.
function virtual_span(span: Span, command: string): Span {
	return { ...span, josh_command: command, own_duration_ms: NO_DURATION, is_continuation: false }
}

// The span, followed by one virtual span per josh command a chain dropped. A continuation is left alone:
// the head fragment it was cut from already carries the chain, and the tables skip continuations anyway.
function expanded(span: Span): Array<Span> {
	if (span.is_continuation) return [span]

	return [span, ...uncounted_commands(span).map((command) => virtual_span(span, command))]
}

// Every span, with each chained call's dropped josh commands added as zero-duration calls. Fed to the
// two josh-keyed tables in place of the raw spans; every other table reads the raw spans, so only those
// two see the expansion.
function with_chained(spans: ReadonlyArray<Span>): Array<Span> {
	return spans.flatMap((span) => expanded(span))
}

const time_josh_commands = { with_chained }

export { time_josh_commands }
